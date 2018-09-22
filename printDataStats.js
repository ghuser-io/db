#!/usr/bin/env node
'use strict';

(() => {

  const fs = require('fs');
  const path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  printDataStats();
  return;

  function printDataStats() {

    let numUsers = 0;
    let largestUserFileName;
    let largestUserFileSize = 0;
    let totalUserSize = 0;
    for (const file of fs.readdirSync(data.users)) {
      if (file.endsWith('.json')) {
        const pathToFile = path.join(data.users, file);
        const user = new DbFile(pathToFile);
        if (!user.ghuser_deleted_because) {
          ++numUsers;
        }
        const userFileSize = fs.statSync(pathToFile).size;
        if (userFileSize > largestUserFileSize) {
          largestUserFileSize = userFileSize;
          largestUserFileName = file;
        }
        totalUserSize += userFileSize;
      }
    }
    console.log(data.users);
    console.log(`  ${numUsers} users`);
    console.log(`  largest: ${largestUserFileName} (${toKB(largestUserFileSize)})`);
    console.log(`  total: ${toKB(totalUserSize)}`);

    let largestContribFileName;
    let largestContribFileSize = 0;
    let totalContribSize = 0;
    for (const file of fs.readdirSync(data.contribs)) {
      if (file.endsWith('.json')) {
        const pathToFile = path.join(data.contribs, file);
        const contribList = new DbFile(pathToFile);
        const contribFileSize = fs.statSync(pathToFile).size;
        if (contribFileSize > largestContribFileSize) {
          largestContribFileSize = contribFileSize;
          largestContribFileName = file;
        }
        totalContribSize += contribFileSize;
      }
    }
    console.log(data.contribs);
    console.log(`  largest: ${largestContribFileName} (${toKB(largestContribFileSize)})`);
    console.log(`  total: ${toKB(totalContribSize)}`);

    let numRepos = 0;
    let numSignificantRepos = 0;
    let largestRepoFileName;
    let largestRepoFileSize = 0;
    let totalRepoSize = 0;
    for (const ownerDir of fs.readdirSync(data.repos)) {
      const pathToOwner = path.join(data.repos, ownerDir);
      for (const file of fs.readdirSync(pathToOwner)) {
        if (file.endsWith('.json')) {
          const pathToFile = path.join(pathToOwner, file);
          const repo = new DbFile(pathToFile);
          ++numRepos;
          numSignificantRepos += !repo.removed_from_github && !repo.ghuser_insignificant && 1 || 0;
          const repoFileSize = fs.statSync(pathToFile).size;
          if (repoFileSize > largestRepoFileSize) {
            largestRepoFileSize = repoFileSize;
            largestRepoFileName = `${ownerDir}/${file}`;
          }
          totalRepoSize += repoFileSize;
        }
      }
    }
    console.log(data.repos);
    console.log(`  ${numRepos} repos`);
    console.log(`  ${numSignificantRepos} significant repos`);
    console.log(`  largest: ${largestRepoFileName} (${toKB(largestRepoFileSize)})`);
    console.log(`  total: ${toKB(totalRepoSize)}`);

    const orgsSize = fs.statSync(data.orgs).size;
    console.log(`${data.orgs}: ${toKB(orgsSize)}`);

    const nonOrgsSize = fs.statSync(data.nonOrgs).size;
    console.log(`${data.nonOrgs}: ${toKB(nonOrgsSize)}`);

    const metaSize = fs.statSync(data.meta).size;
    console.log(`${data.meta}: ${metaSize} B`);

    const totalSize = totalUserSize + totalContribSize + totalRepoSize + orgsSize + nonOrgsSize +
                      metaSize;
    console.log(`total: ${toKB(totalSize)}`);

    console.log(`\n=> ${toKB(totalSize / numUsers)}/user`);

    return;

    function toKB(bytes) {
      return `${Math.round(bytes / 1024)} KB`;
    }
  }

})();
