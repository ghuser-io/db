#!/usr/bin/env node
'use strict';

(() => {

  const meow = require('meow');
  const path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');

  const cli = meow(`
usage:
  $ ./addUser.js USER
  $ ./addUser.js --help
  $ ./addUser.js --version

positional arguments:
  USER        GitHub username, e.g. AurelienLourot
`);

  if (cli.input.length < 1) {
    console.error('Error: USER argument missing. See `./addUser.js --help`.');
    process.exit(1);
  }

  if (cli.input.length > 1) {
    console.error('Error: too many positional arguments. See `./addUser.js --help`.');
    process.exit(1);
  }

  const user = cli.input[0];
  const userId = user.toLowerCase();
  const userFile = new DbFile(path.join(data.users, `${userId}.json`));
  if (userFile.login) {
    console.log(`${user} already exists.`);
    return;
  }

  Object.assign(userFile, {
    login: user,
    ghuser_created_at: (new Date).toISOString()
  });
  userFile.write();
  console.log(`${user} added. You should now run ./fetchAndCalculateAll.sh`);

})();
