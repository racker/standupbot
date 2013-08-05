/* Pre-req's
  npm install irc
  npm install js-yaml
  npm install express
  npm install fs
  npm install async
  npm install cron
  npm install jade
  npm install sqlite3
  npm install sprintf
*/

// Imports
var express = require('express');
var fs = require('fs');
var yaml = require('js-yaml');
var async = require('async');
var jade = require('jade');
var sqlite = require('sqlite3');
var sprintf = require('sprintf-js').sprintf;
var ircHandler = require('./ircHandler');
var STATES = ['completed', 'inprogress', 'impediments'];

// Open db and make sure stats table exists
var db = new sqlite.Database('stats.db');
db.serialize(function() {
  function createStats(callback) {
    db.run("CREATE TABLE stats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, time DATETIME NOT NULL, finished BOOLEAN NOT NULL, inprogress BOOLEAN NOT NULL, impediments BOOLEAN NOT NULL)", function(err) {
      if (err) {
        console.log('stats table already exists.');
      }
      if (callback) {
        callback();
      }
    });
  }

  function createStatuses(callback) {
    db.run("CREATE TABLE statuses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, time DATETIME NOT NULL, state INTEGER NOT NULL, status TEXT NOT NULL, stats INTEGER NOT NULL)", function(err) {
      if (err) {
        console.log('statuses table already exists');
      }
      if (callback) {
        callback();
      }
    });
  }

  createStats(createStatuses);
});

// Load Configuration
var configFile = "./conf/custom-config.yaml";
if (process.argv.length > 2) {
  configFile = process.argv[2];
}
var contents = fs.readFileSync(configFile).toString();
var config = yaml.load(contents).config;

ircHandler.init(config);


// Timers
var timers = config.timers

// Initiate the web framework
var app = express();

app.set('views', __dirname + '/templates');
app.set('view engine', 'jade');
app.use('/static', express.static(__dirname + '/public'));

// Enable web framework to parse HTTP params
app.use(express.bodyParser());
// Enable cookie parsing on requests
app.use(express.cookieParser());

// Serve up the root which includes the form
app.get('/', function(req, res) {
  var locals = {completed: [], inprogress: [], impediments: []}

  function render(templateLocals) {
    if (!templateLocals) {
      templateLocals = {};
    }
    templateLocals.url = req.url;
    templateLocals.cookies = req.cookies;
    res.render('root.jade', templateLocals);
  }

  if (req.cookies.lastID) {
    getStatusForID(req.cookies.lastID, function(err, result) {
      for (var i=0; i<result.length; i++) {
        var row = result[i],
            key = STATES[row.state];
        locals[key].push(row.status);
      }
      render(locals);
    });
  } else {
    render(locals);
  }
});

//Serve up form for getting individual user data
app.get('/user', function(req, res) {
  res.render('user.jade', {});
});

app.post('/api/user', function(req, res) {
    var member = req.body.irc_nick || '';
    getHistoricalData(member, function(err, results) {
      var locals = {
        statsID: results.stats,
        statuses: results.statuses,
        states: {},
     };
      for (var k in STATES) {
        locals.states[k] = STATES[k];
      }
      var body = JSON.stringify(locals);
      res.set('Content-type', 'application/json');
      res.set('Content-length', body.length);
      res.write(body);
      res.end();
    });
});

app.get('/api/user', function(req, res) {
    members = JSON.stringify(config.members);
    res.set('Content-type', 'application/json');
    res.set('Content-length', members.length);
    res.write(members);
    res.end();
});

app.get('/api/historical', function(req, res) {
  getHistoricalData(null, function(err, results) {
    var locals = {
      statsID: results.stats,
      statuses: results.statuses,
      states: {},
      members: config.members
    };

    for (var k in STATES) {
      locals.states[k] = STATES[k];
    }
    var body = JSON.stringify(locals);
    res.set('Content-type', 'application/json');
    res.set('Content-length', body.length);
    res.write(body);
    res.end();
  });
});

// Handle the API request
app.post('/irc', function(req, res){
  // build the output
  var result = "",
      finished = req.body.completed ? 1 : 0,
      inProgress = req.body.inprogress ? 1 : 0,
      impediments = req.body.impediments ? 1 : 0;

  var locals = {
      irc_nick: req.body.irc_nick,
      area: req.body.area,
      nl: '\n' //there has to be a better solution...
  };
  for (var k in STATES) {
    var key = STATES[k];
    locals[key] = req.body[key].split('\n');
  }

  res.cookie('irc_nick', req.body.irc_nick, { domain: config.domain });
  res.cookie('area', req.body.area, { domain: config.domain });

  res.render('partials/ircOutput', locals, function(err, result) {
    if (err) {
      console.log('Error processing input! ' + err);
    }
    result = truncateResult(result);

    ircHandler.publishToChannels(result, function () {
      fs.writeFile(config.members_dir + "/" + req.body.irc_nick, result, function(err) {
        console.log("Logged " + req.body.irc_nick + "'s standup.");
      });
    });
    saveStatsRow(req.body.irc_nick, finished, inProgress, impediments,
           function(err, lastID) {
             saveStatusRows(lastID, locals, function(err) {
               res.cookie('lastID', lastID, { domain: config.domain });
               res.send("<pre>\n" + result + "\n</pre>");
             });
           });
  });
});

// save a row to the db for each status message in a standup
function saveStatusRows(lastID, locals, callback) {
  var now = new Date().getTime(),
      statements = [];
  for (var k in STATES) {
    var key = STATES[k];
    for (var i=0; i<locals[key].length; i++) {
      if (locals[key][i].length) {
        statements.push(['INSERT INTO statuses VALUES (NULL, ?, ?, ?, ?, ?)',
                        [locals.irc_nick, now, k, locals[key][i], lastID]]);
      }
    }
  }

  async.forEach(statements,
      function(item, callback) {
        var stmt = db.prepare(item[0]);
        var args = item[1];
        stmt.run.apply(stmt, args);
        stmt.finalize(callback);
      },
      function(err) {
        callback(err);
      }
  );
}

// trim each line to 500 characters max
function truncateResult(result) {
  var htmlLines = result.split('\n'),
      neededTruncate = false;

  for (var i=0; i < htmlLines.length; i++) {
    if (htmlLines[i].length >= 500) {
      htmlLines[i] = htmlLines[i].slice(0, 497) + '...';
      neededTruncate = true;
    }
  }
  if (neededTruncate) {
    result = htmlLines.join('\n');
  }
  return result
}

function saveStatsRow(name, finished, inProgress, impediments, callback) {
  var now = new Date().getTime();

  db.run("INSERT INTO stats VALUES (NULL, ?, ?, ?, ?, ?)",
         [name, now, finished, inProgress, impediments],
         function(err) {
           callback(err, this.lastID);
        });
}

function getHistoricalData(user, callback) {
  var data = {};
  
  if (user) {
    readUserRows('stats', user, function(err, rows) {
      if (err) { console.log('Error reading database! ' + err); }
      data.stats = rows;
      readUserRows('statuses', user, function(err, rows) {
        if (err) { console.log('Error reading database! ' + err); }
        data.statuses = rows;
        callback(null, data);
      });
    });
  } else {
    readAllRows('stats', function(err, rows) {
      if (err) { console.log('Error reading database! ' + err); }
      data.stats = rows;
      readAllRows('statuses', function(err, rows) {
        if (err) { console.log('Error reading database! ' + err); }
        data.statuses = rows;
        callback(null, data);
      });
    });
  }
}

function getStatusForID(id, callback) {
  db.all('select * from statuses where stats = ?', [id], callback);
};

function readAllRows(table, callback) {
  var rows = [];
  db.all("SELECT * FROM " + table, callback);
}

function readUserRows(table, user, callback) {
  var rows = [];
  db.all(sprintf("SELECT * FROM %s WHERE name='%s'", table, user), callback);
}

process.on('SIGINT', function() {
  console.log("\nGracefully shutting down from SIGINT (Ctrl+C)");

  ircHandler.disconnect();
  db.close();
  process.exit();
});

// Start the server
app.listen(8080);
console.log('Listening on port 8080');
