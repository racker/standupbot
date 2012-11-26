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
var irc = require('irc');
var fs = require('fs');
var yaml = require('js-yaml');
var async = require('async');
var cron = require('cron').CronJob;
var jade = require('jade');
var sqlite = require('sqlite3');

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


// Load Configuration Variables
var nick = config.irc.nick;
var user_name = config.irc.user_name;
var real_name = config.irc.real_name;
var server = config.irc.server;
var port = config.irc.port;
var ssl = config.irc.ssl;
var channels_def = [];
{
  a = config.irc.channels.definitions;
  for (var i = 0; i < a.length; i++) {
    if ('password' in a[i]) {
        channels_def.push(a[i].name + " " + a[i].password);
    }
    else {
        channels_def.push(a[i].name);
    }
  }
}
var channels_publish = config.irc.channels.publish;
var channels_remind  = config.irc.channels.remind;
var members = config.members;
var members_dir = config.members_dir;

if (!fs.existsSync(members_dir)) {
  fs.mkdirSync(members_dir);
  console.log('created members dir at: ' + members_dir);
}
var domain = config.domain;

// Timers
var timers = config.timers

// Connect to IRC
var irc = new irc.Client(server, nick,
       {
         userName: user_name,
         realName: real_name,
         debug: true,
         showErrors: true,
         port: port,
         autoRejoin: true,
         autoConnect: false,
         channels: channels_def,
         secure: ssl,
         selfSigned: true,
         certExpired: true,
         floodProtection: true,
         floodProtectionDelay: 250,
         stripColors: false
       });

// Connect IRC client and initize timers
//irc.connect(function() {
  //new cron(timers.earlyReminder, announceEarlyReminder, null, true);
  //new cron(timers.dueReminder, announceDueReminder, null, true);
  //new cron(timers.lateReminder, announceLateReminder, null, true);
  //new cron(timers.deadlineReminder, announceDeadlineReminder, null, true);
//});

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
  res.cookie('irc_nick', req.body.irc_nick, { domain: domain });
  res.cookie('area', req.body.area, { domain: domain });
  res.send("<pre>\n" + result + "\n</pre>");

  publishToChannels(result, function () {
    fs.writeFile(members_dir + "/" + req.body.irc_nick, result, function(err) {
      console.log("Logged " + req.body.irc_nick + "'s standup.");
    });
  });
  saveRow(req.body.irc_nick, finished, inProgress, impediments); 
});

function publishToChannels(message, callback) {
  var publish = function publish(channel, callback) {
    irc.say(channel, message);
    callback();
  };

  async.forEach(channels_publish, publish, function(err) {
    callback();
  });
}

function remindChannels(message, callback) {
  var remind = function remind(channel, callback) {
    irc.notice(channel, message);
    callback();
  };

  async.forEach(channels_remind, remind, function(err) {
    callback();
  });
}

function saveRow(name, finished, inProgress, impediments, callback) {
  var stmt,
      now = new Date().getTime();

  stmt = db.prepare("INSERT INTO stats VALUES (NULL, ?, ?, ?, ?, ?)");
  stmt.run(name, now, finished, inProgress, impediments);
  stmt.finalize();
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
  fs.readdir(members_dir, function(err, contents) {
    for (var i=0; i < members.length; i++) {
      if (contents.indexOf(members[i]) == -1) {
        missing.push(members[i]);
      }
    }
    callback(null, missing);
  });
}

function clearMemberStandups(callback) {
  fs.readdir(members_dir, function(err, contents) {
    for (var i=0; i < contents.length; i++) {
      fs.unlink(members_dir + '/' + contents[i]);
    }
  });
  callback();
}

function announceEarlyReminder() {
  checkForMissingStandups(function(err, missing) {
    var msg = 'Standups are due soon. (' + missing.join(', ') + ')';
    remindChannels(msg, function() {
      console.log('Reminded channel that standups are due soon.');
    });
  });
}

function announceDueReminder() {
  checkForMissingStandups(function(err, missing) {
    var msg = 'Standups are due! (' + missing.join(', ') + ')';
    remindChannels(msg, function() {
      console.log('Reminded channel that standups are due now.');
    });
  });
}

function announceLateReminder() {
  checkForMissingStandups(function(err, missing) {
    var msg = 'Standups are late! (' + missing.join(', ') + ')';
    remindChannels(msg, function() {
      console.log('Reminded channels that standups are late.');
    });
  });
}

function announceDeadlineReminder() {
  checkForMissingStandups(function(err, missing) {
    var msg = 'The deadline for standups is now. You lose the game! (' + missing.join(', ') + ')';
    remindChannels(msg, function() {
      console.log('Reminded channels that the deadline for standups has passed.');
      clearMemberStandups(function() {
        console.log('Cleared member standups.');
      });
    });
  });
}


// Add listener for error events so the bot doesn't crash when something goes wrong on the server
irc.addListener('error', function(message) {
    console.log('error: ', message);
});

process.on('SIGINT', function() {
    console.log("\nGracefully shutting down from SIGINT (Ctrl+C)");

    irc.disconnect();
    db.close();
    process.exit();
});

// Start the server
app.listen(8080);
console.log('Listening on port 8080');
