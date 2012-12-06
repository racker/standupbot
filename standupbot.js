/* Pre-req's
  npm install irc
  npm install js-yaml
  npm install express
  npm install fs
  npm install async
  npm install cron
  npm install jade
  npm install sqlite3
*/

// Imports
var express = require('express');
var fs = require('fs');
var yaml = require('js-yaml');
var async = require('async');
var cron = require('cron').CronJob;
var jade = require('jade');
var sqlite = require('sqlite3');
var ircHandler = require('./ircHandler');

// Open db and make sure stats table exists
var db = new sqlite.Database('stats.db');
db.serialize(function() {
  db.run("CREATE TABLE stats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, time DATETIME NOT NULL, finished BOOLEAN NOT NULL, inprogress BOOLEAN NOT NULL, impediments BOOLEAN NOT NULL)", function(err) {
    if (err) {
      console.log('stats table already exists.');
    }
  });
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

// Serve up the static webpages which include the form
app.get('/', function(req, res) {
  res.render('layout.jade', {});
});

// Handle the API request
app.post('/irc', function(req, res){
  // build the output
  var result = "",
      finished = req.body.completed ? 1 : 0,
      inProgress = req.body.inprogress ? 1 : 0,
      impediments = req.body.impediments ? 1 : 0;

  result += "---------------------------------------\n"
  result += label_and_break_lines
      ("[" + req.body.irc_nick + ": " + req.body.area + " completed  ] ", req.body.completed);
  result += label_and_break_lines
      ("[" + req.body.irc_nick + ": " + req.body.area + " inprogress ] ", req.body.inprogress);
  result += label_and_break_lines
      ("[" + req.body.irc_nick + ": " + req.body.area + " impediments] ", req.body.impediments);
  result += "---------------------------------------\n"

  console.log(result);
  res.cookie('irc_nick', req.body.irc_nick, { domain: config.domain });
  res.cookie('area', req.body.area, { domain: config.domain });
  res.send("<pre>\n" + result + "\n</pre>");

  ircHandler.publishToChannels(result, function () {
    fs.writeFile(config.members_dir + "/" + req.body.irc_nick, result, function(err) {
      console.log("Logged " + req.body.irc_nick + "'s standup.");
    });
  });
  saveRow(req.body.irc_nick, finished, inProgress, impediments); 
});

function saveRow(name, finished, inProgress, impediments, callback) {
  var stmt,
      now = new Date().getTime();

  stmt = db.prepare("INSERT INTO stats VALUES (NULL, ?, ?, ?, ?, ?)");
  stmt.run(name, now, finished, inProgress, impediments);
  stmt.finalize(callback);
}

function label_and_break_lines(label, msg) {
  var result = "";
  if (msg == null || msg == "") {
    result = label+"\n";
  }
  else {
    var lines = msg.split("\n");
    for (var i = 0; i < lines.length; i++) {
        // line break at 480
        var sublines = lines[i].match(/.{1,480}/g);
        if (sublines == null) {
      continue;
        }
        for (var j = 0; j < sublines.length; j++) {
      result += label + sublines[j] + "\n";
        }
    }
  }
  return result;
}

function checkForMissingStandups(callback) {
  var missing = [];
  console.log("checking for missing standups");
  fs.readdir(config.members_dir, function(err, contents) {
    for (var i=0; i < members.length; i++) {
      if (contents.indexOf(members[i]) == -1) {
        missing.push(members[i]);
      }
    }
    callback(null, missing);
  });
}

function getHistoricalData() {
  var rows = [];
  db.each("SELECT * FROM stats", function(err, row) {
    if (err) {
      console.log("Encountered an error reading from database!");
      console.log(err)
    } else {
      rows.append(row);
    }
    return {rows: rows};
  });
}

process.on('SIGINT', function() {
  console.log("\nGracefully shutting down from SIGINT (Ctrl+C)");

  irc.disconnect();
  db.close();
  process.exit();
});

// Start the server
app.listen(8080);
console.log('Listening on port 8080');
