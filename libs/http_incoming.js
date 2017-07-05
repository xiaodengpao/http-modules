const net             = require("net")
const HTTPParser      = process.binding('http_parser').HTTPParser // 通过binding方法调起C++模块
const EventEmitter    = require('events')

// 变量
const CRLF = "\r\n"
const connectionExpression = /Connection/i
const transferEncodingExpression = /Transfer-Encoding/i
const closeExpression = /close/i
const chunkExpression = /chunk/i
const contentLengthExpression = /Content-Length/i


class Server extends net.Server {
	constructor(props) {
		super(props)
	}
}

exports.createServer = function (requestListener, options) {
    const server = new Server()
    server.addListener("request", requestListener)
    server.addListener("connection", connectionListener)
    return server
}

// 通过net模块，实现对http请求的监听
// 接收TCP消息并进行处理，处理完触发request事件
function connectionListener (socket) {
    // connection.server 是 Server的实例
    // 请求数据加载完毕后，触发request
	const server = this
    console.log(server)
    const parser = new HTTPParser('request')
    parser.socket = socket
    socket.on('data', function (data) {
        // 请求头坐标
        const bytesParsed = parser.execute(data)
        const bodyHead = data.slice(bytesParsed, data.length)
        console.log(bodyHead.toString())
        server.emit('request', parser.incoming, null)
    })
}

// 创建req实例
function createIncomingMessageStream (socket, incoming_listener) {
    const stream = new EventEmitter()
    connection.addListener("messageBegin", function (data) {
  	})
    return stream
}

// 接收的消息
class IncomingMessage extends EventEmitter {
    constructor(options = {}) {
        super(options)
    }
}

// 发送的消息
class OutgoingMessage extends EventEmitter {
    constructor(socket) {
        super()

        // 套接字
        this.socket = socket
        
        // 原始数据
        this.output = []
        // 转码后的数据
        this.outputEncodings = []
        
        this.closeOnFinish = false
        this.chunkedEncoding = false
        this.shouldKeepAlive = true
        this.useChunkedEncodingByDefault = true
        this.flushing = false
        this.headWritten = false
        this._hasBody = true
        this.finished = false
    }

    // 发送数据（伪）
    // 内部基础方法
    _send (data, encoding) {
        // 数据长度
        const length = this.output.length

        if (length === 0 || typeof data != 'string') {
            this.output.push(data)
            encoding = encoding || "ascii"
            this.outputEncodings.push(encoding)
            return
        }

        const lastEncoding = this.outputEncodings[length-1]
        const lastData = this.output[length-1]

        if ((lastEncoding === encoding) ||
        (!encoding && data.constructor === lastData.constructor)) {
            this.output[length-1] = lastData + data
            return
        }

        this.output.push(data)
        encoding = encoding || "ascii"
        this.outputEncodings.push(encoding)
    }

    /** 
     * @desc 发送响应头
     * @param headers object
     */
    sendHeaderLines (firstLine, headers) {
        let sentConnectionHeader = false
        let sentContentLengthHeader = false
        let sentTransferEncodingHeader = false

        // firstLine in the case of request is: "GET /index.html HTTP/1.1\r\n"
        // in the case of response it is: "HTTP/1.1 200 OK\r\n"
        let messageHeader = firstLine
        let field, value

        if (headers) {
            const keys = Object.keys(headers)
            var isArray = (headers instanceof Array)
            // headers解析成字符串
            for (let i = 0, l = keys.length; i < l; i++) {
                var key = keys[i]
                if (isArray) {
                    field = headers[key][0]
                    value = headers[key][1]
                } else {
                    field = key
                    value = headers[key]
                }

                messageHeader += field + ": " + value + CRLF

                if (connectionExpression.test(field)) {
                    sentConnectionHeader = true
                    if (closeExpression.test(value)) this.closeOnFinish = true
                } else if (transferEncodingExpression.test(field)) {
                    sentTransferEncodingHeader = true;
                    if (chunkExpression.test(value)) this.chunkedEncoding = true
                } else if (contentLengthExpression.test(field)) {
                    sentContentLengthHeader = true;
                }
            }
        }

        // keep-alive logic
        if (sentConnectionHeader == false) {
            if (this.shouldKeepAlive && (sentContentLengthHeader || this.useChunkedEncodingByDefault) ) {
                messageHeader += "Connection: keep-alive\r\n"
            } else {
                this.closeOnFinish = true;
                messageHeader += "Connection: close\r\n"
            }
        }

        if (sentContentLengthHeader == false && sentTransferEncodingHeader == false) {
            if (this._hasBody) {
                if (this.useChunkedEncodingByDefault) {
                    messageHeader += "Transfer-Encoding: chunked\r\n"
                    this.chunkedEncoding = true
                } else {
                    this.closeOnFinish = true
                }
            } else {
                // Make sure we don't end the 0\r\n\r\n at the end of the message.
                this.chunkedEncoding = false
            }
        }

        messageHeader += CRLF

        this._send(messageHeader)
    }
}

/**
 * @desc Res
 */
class ServerResponse extends OutgoingMessage{
    constructor (req) {
        super(req.socket)
        if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
            this.useChunkedEncodingByDefault = false;
            this.shouldKeepAlive = false;
        }
    }
    // 写入
    writeHead (statusCode) {
        // 状态详细
        let reasonPhrase, headers, headerIndex
        // writeHead 参数： code、'string'、headerObj
        if (typeof arguments[1] == 'string') {
            reasonPhrase = arguments[1]
            headerIndex = 2
        } else {
            reasonPhrase = STATUS_CODES[statusCode] || "unknown";
            headerIndex = 1
        }

        if (typeof arguments[headerIndex] == 'object') {
            headers = arguments[headerIndex]
        } else {
            headers = {}
        }

        const statusLine = "HTTP/1.1 " + statusCode.toString() + " " + reasonPhrase + CRLF

        if (statusCode === 204 || statusCode === 304) {
            // 重定向
            this._hasBody = false
        }

        this.sendHeaderLines(statusLine, headers)
        this.headWritten = true
    }
}