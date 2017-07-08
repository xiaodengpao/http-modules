const Server = require('./libs/http_server')
function sleep(milliSeconds) { 
    var startTime = new Date().getTime(); 
    while (new Date().getTime() < startTime + milliSeconds);
 }
 
const server = new Server( function(req, res) {
    res.writeHead(200)
    res.write('Sth')
    res.write('123123')
    res.end()
})
server.listen(9999)