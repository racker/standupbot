var irc = require('irc');
var cron = require('cron').CronJob;
var fs = require('fs');
var async = require('async');

var nick,
  user_name,
  real_name,
  server,
  port,
  ssl,
  channels_def,
  channels_publish,
  channels_remind ,
  members,
  members_dir,
  timers,
  client;

exports.init = function(config) {
  // Load Configuration Variables
  loadConfigVariables(config);
  client = makeIrcClient();
}

function makeIrcClient() {
  var client = new irc.Client(server, nick,
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
  client.connect(function() {
    new cron(timers.earlyReminder, announceEarlyReminder, null, true);
    new cron(timers.dueReminder, announceDueReminder, null, true);
    new cron(timers.lateReminder, announceLateReminder, null, true);
    new cron(timers.deadlineReminder, announceDeadlineReminder, null, true);
  });

  // Add listener for error events so the bot doesn't crash when something goes wrong on the server
  client.addListener('error', function(message) {
    console.log('error: ', message);
  });

  return client;
}

function loadConfigVariables(config) {
  nick = config.irc.nick;
  user_name = config.irc.user_name;
  real_name = config.irc.real_name;
  server = config.irc.server;
  port = config.irc.port;
  ssl = config.irc.ssl;
  timers = config.timers;
  channels_def = [];
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
  channels_publish = config.irc.channels.publish;
  channels_remind  = config.irc.channels.remind;
  members = config.members;
  members_dir = config.members_dir;

  if (!fs.existsSync(members_dir)) {
    fs.mkdirSync(members_dir);
    console.log('created members dir at: ' + members_dir);
  }
}


exports.publishToChannels = function(message, callback) {
  var publish = function publish(channel, callback) {
    client.say(channel, message);
    callback();
  };

  async.forEach(channels_publish, publish, function(err) {
    callback();
  });
}

function remindChannels(message, callback) {
  var remind = function remind(channel, callback) {
    client.notice(channel, message);
    callback();
  };

  async.forEach(channels_remind, remind, function(err) {
    callback();
  });
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

function clearMemberStandups(callback) {
  fs.readdir(members_dir, function(err, contents) {
    for (var i=0; i < contents.length; i++) {
      fs.unlink(members_dir + '/' + contents[i]);
    }
  });
  callback();
}

exports.disconnect = function() {client ? client.disconnect() : console.log("no client");};
