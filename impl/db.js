#!/usr/bin/env node
'use strict';

module.exports = {

  // Async generator yielding an instance of DbFile for each user present in the database and not
  // marked as removed ghuser or GitHub.
  asyncNonRemovedUsers,

  // Creates the list of all contribs of a user if it doesn't exist already. In other words, writes
  // an instance of DbFile on disk.
  // @param login Case insensitive.
  createUserContribList,
};


const fs = require('fs');
const path = require('path');

const ora = require('ora');
const sleep = require('await-sleep');

const data = require('./data');
const DbFile = require('./dbFile'); //LA_TODO should be the only include of this file, i.e. move content here?


async function* asyncNonRemovedUsers() {
  const spinnerText = 'Reading users from DB...';
  const spinner = ora(spinnerText).start();
  let numUsers = 0;

  for (const file of fs.readdirSync(data.users)) {
    await sleep(0); // make loop interruptible

    if (file.endsWith(DB_FILE_EXT)) {
      const pathToFile = path.join(data.users, file);
      const user = new DbFile(pathToFile);
      if (!user.ghuser_deleted_because && !user.removed_from_github) {
        ++numUsers;
        spinner.text = `${spinnerText} [${numUsers}]`;

        yield user;
      }
    }
  }

  spinner.succeed(`Found ${numUsers} users in DB`);
}

function createUserContribList(login) {
  if (!login) {
    throw 'login is mandatory';
  }
  (new DbFile(path.join(data.contribs, login.toLowerCase() + DB_FILE_EXT))).write();
}


const DB_FILE_EXT = '.json'; //TODO should be the only occurence of this string in the codebase
