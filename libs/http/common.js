const FreeList         = require('../freelist').FreeList
const incoming         = require('./incoming')
const IncomingMessage  = incoming.IncomingMessage
const readStart        = incoming.readStart
const readStop         = incoming.readStop
const isNumber         = require('util').isNumber
const binding          = process.binding('http_parser')
const methods          = binding.methods
const HTTPParser       = binding.HTTPParser

exports.CRLF = '\r\n'
exports.chunkExpression = /chunk/i
exports.continueExpression = /100-continue/i

const kOnHeaders = HTTPParser.kOnHeaders | 0
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0
const kOnBody = HTTPParser.kOnBody | 0
const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0
const kOnExecute = HTTPParser.kOnExecute | 0

// 没有被调用，可能只有当header超长的时候才会调用
function parserOnHeaders(headers, url) {
    if (this.maxHeaderPairs <= 0 ||
        this._headers.length < this.maxHeaderPairs) {
        this._headers = this._headers.concat(headers)
    }
    this._url += url
}
// 解析headers
function parserOnHeadersComplete (versionMajor, versionMinor, headers, method, url, statusCode, statusMessage, upgrade, shouldKeepAlive) {
    var parser = this

    if (!headers) {
        headers = parser._headers
        parser._headers = []
    }

    if (!url) {
        url = parser._url
        parser._url = ''
    }
    // req原型
    parser.incoming = new IncomingMessage(parser.socket)
    // 几个重要变量的赋值
    parser.incoming.httpVersionMajor = versionMajor
    parser.incoming.httpVersionMinor = versionMinor
    parser.incoming.httpVersion = versionMajor + '.' + versionMinor
    parser.incoming.url = url

    // headers 是一个数组，有最大长度，然后整合成json
    var n = headers.length

    // 判断是否需要截取headers
    // 如果 parser.maxHeaderPairs <= 0 ，说明没有限制
    if (parser.maxHeaderPairs > 0) {
        n = Math.min(n, parser.maxHeaderPairs)
    }
    // 截取固定长度headers，解析出headers
    parser.incoming._addHeaderLines(headers, n)
    parser.incoming.method = methods[method]

    // 类似于提升协议？ 没搞懂，websocket?
    if (upgrade && parser.outgoing !== null && !parser.outgoing.upgrading) {
        upgrade = false
    }

    parser.incoming.upgrade = upgrade
    
    // response to HEAD or CONNECT
    let skipBody = 0 

    if (!upgrade) {
        // For upgraded connections and CONNECT method request, we'll emit this
        // after parser.execute so that we can capture the first part of the new
        // protocol.
        // 回调回server.js   onIncoming方法
        skipBody = parser.onIncoming(parser.incoming, shouldKeepAlive)
    }

    if (typeof skipBody !== 'number')
        return skipBody ? 1 : 0
    else
        return skipBody
}


function parserOnBody(b, start, len) {
    var parser = this
    var stream = parser.incoming

    // if the stream has already been removed, then drop it.
    if (!stream)
        return

    var socket = stream.socket

    // pretend this was the result of a stream._read call.
    if (len > 0 && !stream._dumped) {
        var slice = b.slice(start, start + len);
        var ret = stream.push(slice)
        if (!ret)
            readStop(socket)
    }
}

function parserOnMessageComplete() {
     var parser = this
     var stream = parser.incoming

    if (stream) {
        stream.complete = true
        // Emit any trailing headers.
        var headers = parser._headers
        if (headers) {
            parser.incoming._addHeaderLines(headers, headers.length)
            parser._headers = []
            parser._url = ''
        }

        if (!stream.upgrade)
            // For upgraded connections, also emit this after parser.execute
            stream.push(null)
    }

    if (stream && !parser.incoming._pendings.length) {
        // For emit end event
        stream.push(null)
    }

    // force to read the next incoming message
    readStart(parser.socket)
}


var parsers = new FreeList('parsers', 1000, function () {
    var parser = new HTTPParser(HTTPParser.REQUEST)
    parser._headers = []
    parser._url = ''
    // parser事件监听，依次执行
    parser[kOnHeaders] = parserOnHeaders
    parser[kOnHeadersComplete] = parserOnHeadersComplete
    parser[kOnBody] = parserOnBody
    parser[kOnMessageComplete] = parserOnMessageComplete
    parser[kOnExecute] = null
    
    return parser
})

exports.parsers = parsers

function freeParser(parser, req, socket) {
    if (parser) {
        parser._headers = []
        parser.onIncoming = null
        if (parser.socket)
            parser.socket.parser = null
        parser.socket = null
        parser.incoming = null
        if (parsers.free(parser) === false)
            parser.close()
        parser = null
    }
    if (req) {
        req.parser = null
    }
    if (socket) {
        socket.parser = null
    }
}
exports.freeParser = freeParser


function ondrain() {
    if (this._httpMessage) this._httpMessage.emit('drain')
}


function httpSocketSetup(socket) {
    socket.removeListener('drain', ondrain)
    socket.on('drain', ondrain)
}
exports.httpSocketSetup = httpSocketSetup

exports.methods = methods
