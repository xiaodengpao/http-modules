const Stream           = require('stream')
const timers           = require('timers')
const util             = require('util')
const common           = require('./common')
const CRLF             = common.CRLF
const chunkExpression  = common.chunkExpression


const connectionExpression = /Connection/i
const transferEncodingExpression = /Transfer-Encoding/i
const closeExpression = /close/i
const contentLengthExpression = /Content-Length/i
const dateExpression = /Date/i
const expectExpression = /Expect/i

const automaticHeaders = {
    connection: true,
    'content-length': true,
    'transfer-encoding': true,
    date: true
}
let dateCache
const crlf_buf = new Buffer('\r\n')

function utcDate() {
    if (!dateCache) {
        var d = new Date()
        dateCache = d.toUTCString()
        timers.enroll(utcDate, 1000 - d.getMilliseconds())
        timers._unrefActive(utcDate)
    }
    return dateCache
}
utcDate._onTimeout = function () {
    dateCache = undefined
}


class OutgoingMessage extends Stream {
    constructor (opts) {
        super(opts)
        this.output = []
        this.outputEncodings = []
        this.outputCallbacks = []
        this.writable = true
        this._last = false
        this.chunkedEncoding = false
        this.shouldKeepAlive = true
        this.useChunkedEncodingByDefault = true
        this.sendDate = false
        this._removedHeader = {}
        this._hasBody = true
        this._trailer = ''
        this.finished = false
        this._hangupClose = false
        this._headerSent = false
        this.socket = null
        this.connection = null
        this._header = null
        this._headers = null
        this._headerNames = {}
    }
    
    setTimeout (msecs, callback) {
        if (callback) {
            this.on('timeout', callback)
        }
        if (!this.socket) {
            this.once('socket', function (socket) {
                socket.setTimeout(msecs)
            })
        } else {
            this.socket.setTimeout(msecs)
        }  
    }

    destroy (error) {
        if (this.socket) {
            this.socket.destroy(error)
        } else {
            this.once('socket', function (socket) {
                socket.destroy(error)
            })
        } 
    }

    _send (data, encoding, callback) {
        if (!this._headerSent) {
            if (util.isString(data) &&
                encoding !== 'hex' &&
                encoding !== 'base64') {
                data = this._header + data
            } else {
                this.output.unshift(this._header)
                this.outputEncodings.unshift('binary')
                this.outputCallbacks.unshift(null)
            }
            this._headerSent = true
        }
        return this._writeRaw(data, encoding, callback)
    }

    _writeRaw (data, encoding, callback) {
        if (util.isFunction(encoding)) {
            callback = encoding;
            encoding = null;
        }

        if (data.length === 0) {
            if (util.isFunction(callback))
                process.nextTick(callback);
            return true;
        }

        if (this.connection &&
            this.connection._httpMessage === this &&
            this.connection.writable &&
            !this.connection.destroyed) {
            // There might be pending data in the this.output buffer.
            while (this.output.length) {
                if (!this.connection.writable) {
                    this._buffer(data, encoding, callback)
                    return false
                }
                var c = this.output.shift()
                var e = this.outputEncodings.shift()
                var cb = this.outputCallbacks.shift()
                this.connection.write(c, e, cb)
            }

            return this.connection.write(data, encoding, callback)
        } else if (this.connection && this.connection.destroyed) {
            return false
        } else {
            // buffer, as long as we're not destroyed.
            this._buffer(data, encoding, callback)
            return false
        }
    }

    _buffer (data, encoding, callback) {
        this.output.push(data)
        this.outputEncodings.push(encoding)
        this.outputCallbacks.push(callback)
        return false
    }

    _storeHeader (firstLine, headers) {
        var state = {
            sentConnectionHeader: false,
            sentContentLengthHeader: false,
            sentTransferEncodingHeader: false,
            sentDateHeader: false,
            sentExpect: false,
            messageHeader: firstLine
        }

        var field, value;

        if (headers) {
            var keys = Object.keys(headers);
            var isArray = util.isArray(headers);
            var field, value;

            for (var i = 0, l = keys.length; i < l; i++) {
                var key = keys[i];
                if (isArray) {
                    field = headers[key][0];
                    value = headers[key][1];
                } else {
                    field = key;
                    value = headers[key];
                }

                if (util.isArray(value)) {
                    for (var j = 0; j < value.length; j++) {
                        storeHeader(this, state, field, value[j]);
                    }
                } else {
                    storeHeader(this, state, field, value);
                }
            }
        }

        if (this.sendDate === true && state.sentDateHeader === false) {
            state.messageHeader += 'Date: ' + utcDate() + CRLF;
        }

        var statusCode = this.statusCode;
        if ((statusCode === 204 || statusCode === 304) &&
            this.chunkedEncoding === true) {
            this.chunkedEncoding = false;
            this.shouldKeepAlive = false;
        }

        // keep-alive logic
        if (this._removedHeader.connection) {
            this._last = true;
            this.shouldKeepAlive = false;
        } else if (state.sentConnectionHeader === false) {
            var shouldSendKeepAlive = this.shouldKeepAlive &&
                (state.sentContentLengthHeader ||
                    this.useChunkedEncodingByDefault ||
                    this.agent);
            if (shouldSendKeepAlive) {
                state.messageHeader += 'Connection: keep-alive\r\n';
            } else {
                this._last = true;
                state.messageHeader += 'Connection: close\r\n';
            }
        }

        if (state.sentContentLengthHeader === false &&
            state.sentTransferEncodingHeader === false) {
            if (this._hasBody && !this._removedHeader['transfer-encoding']) {
                if (this.useChunkedEncodingByDefault) {
                    state.messageHeader += 'Transfer-Encoding: chunked\r\n';
                    this.chunkedEncoding = true;
                } else {
                    this._last = true;
                }
            } else {
                // Make sure we don't end the 0\r\n\r\n at the end of the message.
                this.chunkedEncoding = false;
            }
        }

        this._header = state.messageHeader + CRLF;
        this._headerSent = false;
        if (state.sentExpect) this._send('');
    }

    setHeader (name, value) {
        if (typeof name !== 'string')
            throw new TypeError('"name" should be a string');
        if (value === undefined)
            throw new Error('"name" and "value" are required for setHeader().');
        if (this._header)
            throw new Error('Can\'t set headers after they are sent.');

        if (this._headers === null)
            this._headers = {};

        var key = name.toLowerCase();
        this._headers[key] = value;
        this._headerNames[key] = name;

        if (automaticHeaders[key])
            this._removedHeader[key] = false;
    }

    end (data, encoding, callback) {
        if (util.isFunction(data)) {
            callback = data;
            data = null;
        } else if (util.isFunction(encoding)) {
            callback = encoding;
            encoding = null;
        }

        if (data && !util.isString(data) && !util.isBuffer(data)) {
            throw new TypeError('first argument must be a string or Buffer');
        }

        if (this.finished) {
            return false;
        }

        var self = this;
        function finish() {
            self.emit('finish');
        }

        if (util.isFunction(callback))
            this.once('finish', callback);


        if (!this._header) {
            this._implicitHeader();
        }

        if (data && !this._hasBody) {
            data = null;
        }

        if (this.connection && data)
            this.connection.cork();

        var ret;
        if (data) {
            // Normal body write.
            ret = this.write(data, encoding);
        }

        if (this._hasBody && this.chunkedEncoding) {
            ret = this._send('0\r\n' + this._trailer + '\r\n', 'binary', finish);
        } else {
            // Force a flush, HACK.
            ret = this._send('', 'binary', finish);
        }

        if (this.connection && data)
            this.connection.uncork();

        this.finished = true;

        // There is the first message on the outgoing queue, and we've sent
        // everything to the socket.
        if (this.output.length === 0 && this.connection._httpMessage === this) {
            this._finish();
        }

        return ret
    }

    getHeader (name) {
        if (arguments.length < 1) {
            throw new Error('`name` is required for getHeader().');
        }

        if (!this._headers) return;

        var key = name.toLowerCase();
        return this._headers[key];
    }

    removeHeader (name) {
        if (arguments.length < 1) {
            throw new Error('`name` is required for removeHeader().');
        }

        if (this._header) {
            throw new Error('Can\'t remove headers after they are sent.');
        }

        var key = name.toLowerCase();

        if (key === 'date')
            this.sendDate = false;
        else if (automaticHeaders[key])
            this._removedHeader[key] = true;

        if (this._headers) {
            delete this._headers[key];
            delete this._headerNames[key];
        }
    }

    _renderHeaders () {
        if (this._header) {
            throw new Error('Can\'t render headers after they are sent to the client.');
        }

        if (!this._headers) return {};

        var headers = {};
        var keys = Object.keys(this._headers);

        for (var i = 0, l = keys.length; i < l; i++) {
            var key = keys[i];
            headers[this._headerNames[key]] = this._headers[key];
        }
        return headers;
    }

    write (chunk, encoding, callback) {
        var self = this;

        if (this.finished) {
            var err = new Error('write after end');
            process.nextTick(function () {
                self.emit('error', err);
                if (callback) callback(err);
            });

            return true;
        }

        if (!this._header) {
            this._implicitHeader();
        }

        if (!this._hasBody) {
            return true;
        }

        if (!util.isString(chunk) && !util.isBuffer(chunk)) {
            throw new TypeError('first argument must be a string or Buffer');
        }


        // If we get an empty string or buffer, then just do nothing, and
        // signal the user to keep writing.
        if (chunk.length === 0) return true;

        var len, ret;
        if (this.chunkedEncoding) {
            if (util.isString(chunk) &&
                encoding !== 'hex' &&
                encoding !== 'base64' &&
                encoding !== 'binary') {
                len = Buffer.byteLength(chunk, encoding);
                chunk = len.toString(16) + CRLF + chunk + CRLF;
                ret = this._send(chunk, encoding, callback);
            } else {
                // buffer, or a non-toString-friendly encoding
                if (util.isString(chunk))
                    len = Buffer.byteLength(chunk, encoding);
                else
                    len = chunk.length;

                if (this.connection && !this.connection.corked) {
                    this.connection.cork();
                    var conn = this.connection;
                    process.nextTick(function connectionCork() {
                        if (conn)
                            conn.uncork();
                    });
                }
                this._send(len.toString(16), 'binary', null);
                this._send(crlf_buf, null, null);
                this._send(chunk, encoding, null);
                ret = this._send(crlf_buf, null, callback);
            }
        } else {
            ret = this._send(chunk, encoding, callback);
        }

        return ret;
    }

    addTrailers (headers) {
        this._trailer = '';
        var keys = Object.keys(headers);
        var isArray = util.isArray(headers);
        var field, value;
        for (var i = 0, l = keys.length; i < l; i++) {
            var key = keys[i];
            if (isArray) {
                field = headers[key][0];
                value = headers[key][1];
            } else {
                field = key;
                value = headers[key];
            }

            this._trailer += field + ': ' + value + CRLF;
        }
    }

    _finish () {
        this.emit('prefinish')
    }

    _flush () {
        if (this.socket && this.socket.writable) {
            var ret;
            while (this.output.length) {
                var data = this.output.shift();
                var encoding = this.outputEncodings.shift();
                var cb = this.outputCallbacks.shift();
                ret = this.socket.write(data, encoding, cb);
            }

            if (this.finished) {
                // This is a queue to the server or client to bring in the next this.
                this._finish();
            } else if (ret) {
                // This is necessary to prevent https from breaking
                this.emit('drain');
            }
        }
    }
    // 奔流
    flush () {
        if (!this._header) {
            this._implicitHeader();
            this._send('');
        }
    }
}






function storeHeader(self, state, field, value) {
    if (/[\r\n]/.test(value)) {
        value = value.replace(/[\r\n]+[ \t]*/g, '')
    }

    state.messageHeader += field + ': ' + value + CRLF

    if (connectionExpression.test(field)) {
        state.sentConnectionHeader = true;
        if (closeExpression.test(value)) {
            self._last = true;
        } else {
            self.shouldKeepAlive = true;
        }

    } else if (transferEncodingExpression.test(field)) {
        state.sentTransferEncodingHeader = true;
        if (chunkExpression.test(value)) self.chunkedEncoding = true;

    } else if (contentLengthExpression.test(field)) {
        state.sentContentLengthHeader = true;
    } else if (dateExpression.test(field)) {
        state.sentDateHeader = true;
    } else if (expectExpression.test(field)) {
        state.sentExpect = true;
    }
}


module.exports = {
    OutgoingMessage: OutgoingMessage
}