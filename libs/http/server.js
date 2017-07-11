const net = require("net")
const HTTPParser = process.binding('http_parser').HTTPParser // 通过binding方法调起C++模块
const EventEmitter = require('events')
const util = require('util')
const OutgoingMessage = require('./outgoing').OutgoingMessage


const common = require('./common')
const parsers = common.parsers
const freeParser = common.freeParser
const CRLF = common.CRLF
const continueExpression = common.continueExpression
const chunkExpression = common.chunkExpression

function onServerResponseClose() {
    if (this._httpMessage) {
        this._httpMessage.emit('close')
    }
}

// Res类
class ServerResponse extends OutgoingMessage {
    constructor (req) {
        super()
        if (req.method === 'HEAD') this._hasBody = false
        this.sendDate = true
        if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
            this.useChunkedEncodingByDefault = chunkExpression.test(req.headers.te)
            this.shouldKeepAlive = false
        }
    }
    // 分配socket
    assignSocket (socket) {
        // 一个socket一个res
        socket._httpMessage = this
        socket.on('close', onServerResponseClose)
        this.socket = socket
        this.connection = socket
        this.emit('socket', socket)
        this._flush()
    }
    writeContinue (cb) {
        this._writeRaw('HTTP/1.1 100 Continue' + CRLF + CRLF, 'ascii', cb)
        this._sent100 = true
    }
    writeHead (statusCode, reason, obj) {
        var headers

        if (util.isString(reason)) {
            this.statusMessage = reason;
        } else {
            this.statusMessage = this.statusMessage || 'ok'
            obj = reason
        }
        this.statusCode = statusCode;

        if (this._headers) {
            if (obj) {
                var keys = Object.keys(obj)
                for (var i = 0; i < keys.length; i++) {
                    var k = keys[i]
                    if (k) this.setHeader(k, obj[k])
                }
            }
            headers = this._renderHeaders();
        } else {
            headers = obj;
        }

        var statusLine = 'HTTP/1.1 ' + statusCode.toString() + ' ' +
                        this.statusMessage + CRLF;

        if (statusCode === 204 || statusCode === 304 ||
            (100 <= statusCode && statusCode <= 199)) {
            this._hasBody = false;
        }

        if (this._expect_continue && !this._sent100) {
            this.shouldKeepAlive = false;
        }

        this._storeHeader(statusLine, headers);
    }

    detachSocket (socket) {
        socket.removeListener('close', onServerResponseClose)
        socket._httpMessage = null
        this.socket = this.connection = null
    }
}
// Server类
class Server extends net.Server {
    constructor(requestListener) {
        // 初始化net
        super({ allowHalfOpen: true })

        // 监听request事件，触发callback
        this.addListener('request', requestListener)

        this.addListener('connection', connectionListener)
        
        // 10S中断
        this.timeout = 10 * 1000
    }
}

// 监听socket的connection
function connectionListener(socket) {
    const self = this
    // 返回队列
    const outgoing = []
    // 接受队列
    const incoming = []

    // socket关闭时触发的回调
    function serverSocketCloseListener() {
        console.log('socket close!')
    }

    // 超时处理
    if (self.timeout) {
        // socket 设置超时时间，超时后触发timeout事件
        socket.setTimeout(self.timeout)
    }
    
    socket.on('timeout', function () {
        socket.destroy()
    })
    // 从parsers队列中返回一个parser
    const parser = parsers.alloc()
    
    // 互相引用一发
    parser.socket = socket
    socket.parser = parser
    
    // 即将接收的消息
    parser.incoming = null

    parser.maxHeaderPairs = 2000

    socket.addListener('error', socketOnError)
    socket.addListener('close', serverSocketCloseListener)
    
    // incoming事件监听
    parser.onIncoming = parserOnIncoming
    
    socket.on('end', socketOnEnd)
    socket.on('data', socketOnData)

    function socketOnError(e) {
        self.emit('clientError', e, this)
    }

    // 请求数据的入口
    function socketOnData(d) {
        // incoming，执行onIncoming
        // ret: 头字节位置,excute函数解析出incoming，也就是
        const ret = parser.execute(d)
        
        if (parser.incoming && parser.incoming.upgrade) {
            const bytesParsed = ret
            const req = parser.incoming

            socket.removeListener('data', socketOnData);
            socket.removeListener('end', socketOnEnd);
            socket.removeListener('close', serverSocketCloseListener);
            parser.finish();
            freeParser(parser, req, null);
            parser = null;

            var eventName = req.method === 'CONNECT' ? 'connect' : 'upgrade';
            if (EventEmitter.listenerCount(self, eventName) > 0) {
                var bodyHead = d.slice(bytesParsed, d.length);

                // TODO(isaacs): Need a way to reset a stream to fresh state
                // IE, not flowing, and not explicitly paused.
                socket._readableState.flowing = null;
                self.emit(eventName, req, socket, bodyHead);
            } else {
                // Got upgrade header or CONNECT method, but have no handler.
                socket.destroy();
            }
        }

        if (socket._paused) {
            socket.parser.pause();
        }
    }

    function socketOnEnd() {
        var socket = this;
        var ret = parser.finish();

        if (ret instanceof Error) {
            socket.destroy(ret);
            return;
        }
        socket.end()
    }


    // The following callback is issued after the headers have been read on a
    // new message. In this callback we setup the response object and pass it
    // to the user.

    socket._paused = false;
    function socketOnDrain() {
        // If we previously paused, then start reading again.
        if (socket._paused) {
            socket._paused = false;
            socket.parser.resume();
            socket.resume();
        }
    }
    socket.on('drain', socketOnDrain);

    function parserOnIncoming(req, shouldKeepAlive) {
        incoming.push(req)
        // If the writable end isn't consuming, then stop reading
        // so that we don't become overwhelmed by a flood of
        // pipelined requests that may never be resolved.
        if (!socket._paused) {
            var needPause = socket._writableState.needDrain;
            if (needPause) {
                socket._paused = true;
                // We also need to pause the parser, but don't do that until after
                // the call to execute, because we may still be processing the last
                // chunk.
                socket.pause();
            }
        }

        var res = new ServerResponse(req)
        
        // 是否长连接，由客户端决定
        res.shouldKeepAlive = shouldKeepAlive

        if (socket._httpMessage) {
            // There are already pending outgoing res, append.
            outgoing.push(res);
        } else {
            res.assignSocket(socket)
        }

        // When we're finished writing the response, check if this is the last
        // respose, if so destroy the socket.
        res.on('prefinish', resOnFinish);
        function resOnFinish() {
            incoming.shift();
            if (!req._consuming && !req._readableState.resumeScheduled)
                req._dump();

            res.detachSocket(socket);

            if (res._last) {
                socket.destroySoon();
            } else {
                // start sending the next message
                var m = outgoing.shift();
                if (m) {
                    m.assignSocket(socket);
                }
            }
        }

        if (!util.isUndefined(req.headers.expect) &&
            (req.httpVersionMajor == 1 && req.httpVersionMinor == 1) &&
            continueExpression.test(req.headers['expect'])) {
            res._expect_continue = true;
            if (EventEmitter.listenerCount(self, 'checkContinue') > 0) {
                self.emit('checkContinue', req, res);
            } else {
                res.writeContinue();
                self.emit('request', req, res);
            }
        } else {
            self.emit('request', req, res);
        }
        return false; // Not a HEAD response. (Not even a response!)
    }
}

module.exports = Server