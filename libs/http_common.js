const FreeList         = require('./freelist').FreeList
const HTTPParser       = process.binding('http_parser').HTTPParser
const incoming         = require('_http_incoming')
const IncomingMessage  = incoming.IncomingMessage
const readStart        = incoming.readStart
const readStop         = incoming.readStop
const isNumber         = require('util').isNumber

exports.CRLF = '\r\n'
exports.chunkExpression = /chunk/i
exports.continueExpression = /100-continue/i
exports.methods = HTTPParser.methods

const kOnHeaders = HTTPParser.kOnHeaders | 0
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0
const kOnBody = HTTPParser.kOnBody | 0
const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0


function parserOnHeaders(headers, url) {
    // Once we exceeded headers limit - stop collecting them
    if (this.maxHeaderPairs <= 0 ||
        this._headers.length < this.maxHeaderPairs) {
        this._headers = this._headers.concat(headers)
    }
    this._url += url
}

function parserOnHeadersComplete(info) {
    debug('parserOnHeadersComplete', info)
    var parser = this
    var headers = info.headers
    var url = info.url

    if (!headers) {
        headers = parser._headers
        parser._headers = []
    }

    if (!url) {
        url = parser._url
        parser._url = ''
    }

    parser.incoming = new IncomingMessage(parser.socket)
    parser.incoming.httpVersionMajor = info.versionMajor
    parser.incoming.httpVersionMinor = info.versionMinor
    parser.incoming.httpVersion = info.versionMajor + '.' + info.versionMinor
    parser.incoming.url = url

    var n = headers.length

    // If parser.maxHeaderPairs <= 0 - assume that there're no limit
    if (parser.maxHeaderPairs > 0) {
        n = Math.min(n, parser.maxHeaderPairs)
    }

    parser.incoming._addHeaderLines(headers, n)

    if (isNumber(info.method)) {
        // server only
        parser.incoming.method = HTTPParser.methods[info.method]
    } else {
        // client only
        parser.incoming.statusCode = info.statusCode
        parser.incoming.statusMessage = info.statusMessage
    }

    parser.incoming.upgrade = info.upgrade

    var skipBody = false // response to HEAD or CONNECT

    if (!info.upgrade) {
        // For upgraded connections and CONNECT method request,
        // we'll emit this after parser.execute
        // so that we can capture the first part of the new protocol
        skipBody = parser.onIncoming(parser.incoming, info.shouldKeepAlive)
    }

    return skipBody;
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

   
    parser[kOnHeaders] = parserOnHeaders
    parser[kOnHeadersComplete] = parserOnHeadersComplete
    parser[kOnBody] = parserOnBody
    parser[kOnMessageComplete] = parserOnMessageComplete

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
exports.httpSocketSetup = httpSocketSetup;
