const Server = require('./libs/http').Server
function sleep(milliSeconds) { 
    var startTime = new Date().getTime(); 
    while (new Date().getTime() < startTime + milliSeconds);
 }
 
const server = new Server( function(req, res) {
    res.writeHead(200)
    res.end('gogo')
})
server.listen(9999)