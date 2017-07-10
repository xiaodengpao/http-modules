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
        this.socket = socket;
        this.connection = socket;
        this.httpVersionMajor = null;
        this.httpVersionMinor = null;
        this.httpVersion = null;
        this.complete = false;
        this.headers = {};
        this.rawHeaders = [];
        this.trailers = {};
        this.rawTrailers = [];
        this.readable = true;
        this._pendings = [];
        this._pendingIndex = 0;
        this.upgrade = null;
        this.url = '';
        this.method = null;
        this.statusCode = null;
        this.statusMessage = null;
        this.client = this.socket;
        this._consuming = false;
        this._dumped = false;
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
                var k = headers[i];
                var v = headers[i + 1];
                raw.push(k);
                raw.push(v);
                this._addHeaderLine(k, v, dest);
            }
        }
    }

    _addHeaderLine (field, value, dest) {
        field = field.toLowerCase()
        switch (field) {
            // Array headers:
            case 'set-cookie':
                if (!util.isUndefined(dest[field])) {
                    dest[field].push(value);
                } else {
                    dest[field] = [value];
                }
                break;

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
                // drop duplicates
                if (util.isUndefined(dest[field]))
                    dest[field] = value;
                break;

            default:
                // make comma-separated list
                if (!util.isUndefined(dest[field]))
                    dest[field] += ', ' + value;
                else {
                    dest[field] = value;
                }
        }
    }

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