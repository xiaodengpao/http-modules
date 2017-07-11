const util        = require('util')
const Stream      = require('stream')

function readStart(socket) {
    if (socket && !socket._paused && socket.readable)
        socket.resume();
}

function readStop(socket) {
    if (socket) {
        socket.pause()
    }
}


class IncomingMessage extends Stream.Readable {
    constructor (socket) {
        super(socket)
        this.socket = socket
        this.connection = socket
        this.httpVersionMajor = null
        this.httpVersionMinor = null
        this.httpVersion = null
        
        // 这个参数不知道干嘛的
        this.complete = false;
        
        this.headers = {}
        this.rawHeaders = []
        this.trailers = {}
        this.rawTrailers = []
        this.readable = true
        this._pendings = []
        this._pendingIndex = 0
        this.upgrade = null
        this.url = ''
        this.method = null
        this.statusCode = null
        this.statusMessage = null
        this.client = this.socket
        this._consuming = false
        this._dumped = false
    }

    setTimeout (msecs, callback) {
        if (callback) {
            this.on('timeout', callback)
        }
        this.socket.setTimeout(msecs)
    }

    read (n) {
        this._consuming = true;
        this.read = Stream.Readable.prototype.read;
        return this.read(n);
    }

    _read (n) {
        if (this.socket.readable) {
            readStart(this.socket)
        }       
    }

    destroy (error) {
        if (this.socket) {
            this.socket.destroy(error)
        }
    }

    // headers长度 n
    _addHeaderLines (headers, n) {
        if (headers && headers.length) {
            var raw, dest;
            if (this.complete) {
                raw = this.rawTrailers;
                dest = this.trailers;
            } else {
                raw = this.rawHeaders;
                dest = this.headers;
            }
            
            for (var i = 0; i < n; i += 2) {
                var k = headers[i]
                var v = headers[i + 1]
                // raw的意义是什么
                raw.push(k)
                raw.push(v)
                this._addHeaderLine(k, v, dest);
            }
        }
    }

    // dest: this.headers
    _addHeaderLine (field, value, dest) {
        field = field.toLowerCase()
        switch (field) {
            // 数组header:
            case 'set-cookie':
                if (!util.isUndefined(dest[field])) {
                    // 多个并存
                    dest[field].push(value);
                } else {
                    dest[field] = [value];
                }
                break
            // 非数组header
            case 'content-type':
            case 'content-length':
            case 'user-agent':
            case 'referer':
            case 'host':
            case 'authorization':
            case 'proxy-authorization':
            case 'if-modified-since':
            case 'if-unmodified-since':
            case 'from':
            case 'location':
            case 'max-forwards':
                // 先入为主
                if (util.isUndefined(dest[field]))
                    dest[field] = value;
                break;

            default:
                // 逗号分隔，和cookie策略相同
                if (!util.isUndefined(dest[field]))
                    dest[field] += ', ' + value;
                else {
                    dest[field] = value;
                }
        }
    }

    //是否累积，否就重新开始
    _dump () {
        if (!this._dumped) {
            this._dumped = true
            this.resume()
        }
    }
}

module.exports = {
    readStart: readStart,
    readStop: readStop,
    IncomingMessage: IncomingMessage
}