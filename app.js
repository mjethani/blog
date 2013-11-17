var express = require('express');
var http = require('http');
var path = require('path');

var fs = require('fs');
var ini = require('ini');

var blog = require('./blog');

function loadConfig(file, obj) {
  var s = fs.readFileSync(file, { encoding: 'utf8' });
  var o = ini.parse(s);

  for (var p in o) {
    obj[p] = o[p];
  }

  return obj;
}

var config = loadConfig(path.join(__dirname, 'config.ini'), {
  // Defaults
  'posts directory': path.join(__dirname, 'posts'),
  'cache timeout'  : 10 * 60 * 1000, // 10 minutes
});

var routes = blog(config).getRoutes();

var app = express();

var themeDirectory = path.join(__dirname, 'public', 'themes',
    config['theme'] || 'default');

app.set('port', process.env.PORT || 3000);
app.set('views', themeDirectory);
app.set('view engine', 'ejs');
app.use(express.logger('dev'));
app.use(express.compress());
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

if ('development' === app.get('env')) {
  app.use(express.errorHandler());
}

app.use(function (req, res) {
  res.status(404);
  res.sendfile('404.html', { root: themeDirectory });
});

app.use(function (error, req, res, next) {
  // Something broke!
  console.error(error.stack);

  res.type('text/html; charset=utf-8');

  res.status(500);
  res.sendfile('500.html', { root: themeDirectory }, function (e) {
    if (e) {
      console.error(e.stack);

      res.type('text');
      res.send('Internal server error');
    }
  });
});

app.get('/', routes.index);
app.get('/:slug', routes.post);

if (config['rss']) {
  // Our patchy RSS support is opt-in for now.
  app.get('/rss', routes.rss);
}

app.get('/tag/:tag', routes.tag);

http.createServer(app).listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});

