var express = require('express');

var app = express(express.logger());
var server = require('http').createServer(app);

app.use(express['static'](__dirname + '/../client'));

var port = process.env.PORT || 3000;
server.listen(port, function() {
  console.log('Listening on port ' + port);
});