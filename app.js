const Server = require('./libs/http_server')
const server = new Server( function(req, res) {
    res.writeHead(200)
    res.end()
})
server.listen(9999)