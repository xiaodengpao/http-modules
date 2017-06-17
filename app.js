const net = require('net')
const sockets_array = []

net.createServer(socket => {
    sockets_array.push(socket)
    // 我们获得一个连接 - 该连接自动关联一个socket对象
    console.log('获得一个新连接: ' +
        socket.remoteAddress + ':' + socket.remotePort)

    // 为这个socket实例添加一个"data"事件处理函数
    socket.on('data', function(data) {
        // 回发该数据，客户端将收到来自服务端的数据
        console.log(data.readInt32BE())
    })

    socket.on('connection', data => {
        console.log(data)
    })

    // 为这个socket实例添加一个"close"事件处理函数
    socket.on('close', function(data) {
        console.log('CLOSED: ' +
            socket.remoteAddress + ' ' + socket.remotePort)
    })

}).listen('127.0.0.1', 6969)