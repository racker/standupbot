var assert = require("assert");
var ircHandler = require("../ircHandler.js")


describe('checkForMissingStandups', function(){
    it('Should find a missing standup', function(done){

    config = {
      "members_dir": "test/members",
      "members": ["test1", "test2"]
    };

    ircHandler.checkForMissingStandups(config,done);
  })
})
