/**
 * xprezzo-json-parser
 * Copyright(c) 2020 Ben Ajenoui <info@seohero.io>
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

const bytes = require('xprezzo-raw-body').bytes
const contentType = require('content-type')
const createError = require('xprezzo-raw-body').httpErrors
const debug = require('xprezzo-raw-body').debug('xprezzo:json-parser')
const Reader = require('xprezzo-raw-body').Reader
const typeis = require('type-is')
const prop = new WeakMap()

function parseBody (body) {
  const self = prop.get(this)
  let result = false
  if (body.length === 0) {
    // special-case empty json body, as it's a common client-side mistake
    // TODO: maybe make this configurable or part of "strict" option
    return {}
  }

  if (self.parsedStrict) {
    var first = firstchar(body)
    if (first !== '{' && first !== '[') {
      debug('strict violation')
      throw createStrictSyntaxError(body, first)
    }
  }
  try {
    debug('parse json')
    result = JSON.parse(body, self.reviver)
  } catch (e) {
    throw normalizeJsonSyntaxError(e, {
      message: e.message,
      stack: e.stack
    })
  }
  return result
}

const checkParse = (req, res, next, self, charset) => {
  if (req._body) {
    debug('body already parsed')
    next()
    return false
  }
  // skip requests without bodies
  if (!typeis.hasBody(req)) {
    debug('skip empty body')
    next()
    return false
  }
  debug('content-type %j', req.headers['content-type'])

  // determine if request should be parsed
  if (!self.shouldParse(req)) {
    debug('skip parsing')
    next()
    return false
  }
  if (charset.substr(0, 4) !== 'utf-') {
    debug('invalid charset')
    next(createError(415, 'unsupported charset "' + charset.toUpperCase() + '"', {
      charset: charset,
      type: 'charset.unsupported'
    }))
    return false
  }
  return true
}

function createReader () {
  const self = prop.get(this)
  const that = this
  return (req, res, next) => {
    req.body = req.body || {}
    // assert charset per RFC 7159 sec 8.1
    const charset = getCharset(req) || 'utf-8'
    if (!checkParse(req, res, next, self, charset)) {
      return
    }
    Reader(req, res, next, (body) => { return parseBody.call(that, body) }, debug, {
      encoding: charset,
      inflate: self.parsedInflate,
      limit: self.parsedLimit,
      verify: self.parsedVerify
    })
  }
}

class JsonParser {
  constructor (options) {
    const opts = options || {}
    opts.parsedLimit = typeof opts.limit !== 'number'
      ? bytes.parse(opts.limit || '100kb')
      : opts.limit
    opts.parsedInflate = opts.inflate !== false
    opts.parsedStrict = opts.strict !== false
    opts.parsedType = opts.type || 'application/json'
    opts.parsedVerify = opts.verify || false

    if (opts.parsedVerify !== false && typeof opts.parsedVerify !== 'function') {
      throw new TypeError('option verify must be function')
    }
    // create the appropriate type checking function
    opts.shouldParse = typeof opts.parsedType !== 'function'
      ? typeChecker(opts.parsedType)
      : opts.parsedType
    prop.set(this, opts)
    return createReader.call(this)
  }
}

/**
 * Create strict violation syntax error matching native error.
 *
 * @param {string} str
 * @param {string} char
 * @return {Error}
 * @private
 */
const createStrictSyntaxError = (str, char) => {
  var index = str.indexOf(char)
  var partial = str.substring(0, index) + '#'

  try {
    JSON.parse(partial)
    /* istanbul ignore next */
    throw new SyntaxError('strict violation')
  } catch (e) {
    return normalizeJsonSyntaxError(e, {
      message: e.message.replace('#', char),
      stack: e.stack
    })
  }
}

/**
 * Get the first non-whitespace character in a string.
 *
 * @param {string} str
 * @return {function}
 * @private
 */

const firstchar = (str) => {
  return /^\s*(.)/.exec(str)[1]
}

/**
 * Get the charset of a request.
 *
 * @param {object} req
 * @api private
 */

const getCharset = (req) => {
  try {
    return (contentType.parse(req).parameters.charset || '').toLowerCase()
  } catch (e) {
    return undefined
  }
}

/**
 * Normalize a SyntaxError for JSON.parse.
 *
 * @param {SyntaxError} error
 * @param {object} obj
 * @return {SyntaxError}
 */

const normalizeJsonSyntaxError = (error, obj) => {
  var keys = Object.getOwnPropertyNames(error)

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    if (key !== 'stack' && key !== 'message') {
      delete error[key]
    }
  }

  // replace stack before message for Node.js 0.10 and below
  error.stack = obj.stack.replace(error.message, obj.message)
  error.message = obj.message

  return error
}

/**
 * Get the simple type checker.
 *
 * @param {string} type
 * @return {function}
 */

const typeChecker = (type) => {
  return (req) => {
    return Boolean(typeis(req, type))
  }
}

/**
 * Module exports.
 * Create a middleware to parse JSON bodies.
 *
 * @param {object} [options]
 * @return {function}
 * @public
 */

module.exports = (options) => { return new JsonParser(options) }
