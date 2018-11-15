#!/usr/bin/env node
'use strict';

(() => {

  const fs = require('fs');
  const path = require('path');

  const data = require('./impl/data');
  const db = require('./impl/db');
  const DbFile = require('./impl/dbFile');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  asyncPrintDataStats();
  return;

  async function asyncPrintDataStats() {

    let numUsers = 0;
    let largestUserFileName;
    let largestUserFileSize = 0;
    let totalUserSize = 0;
    for await (const user of db.asyncNonRemovedUsers()) {
      ++numUsers;
      const userFileSize = user.sizeBytes();
      if (userFileSize > largestUserFileSize) {
        largestUserFileSize = userFileSize;
        largestUserFileName = user.login;
      }
      totalUserSize += userFileSize;
    }
    console.log(data.users);
    console.log(`  ${numUsers} users`);
    console.log(`  largest: ${largestUserFileName} (${toKB(largestUserFileSize)})`);
    console.log(`  total: ${toKB(totalUserSize)}`);
    throw 'LA_TEMP';

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
    console.log(`  total: ${toMB(totalContribSize)}`);

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
    console.log(`  total: ${toMB(totalRepoSize)}`);

    let largestRepoCommitsFileName;
    let largestRepoCommitsFileSize = 0;
    let totalRepoCommitsSize = 0;
    for (const ownerDir of fs.readdirSync(data.repoCommits)) {
      const pathToOwner = path.join(data.repoCommits, ownerDir);
      for (const file of fs.readdirSync(pathToOwner)) {
        if (file.endsWith('.json')) {
          const pathToFile = path.join(pathToOwner, file);
          const repoCommits = new DbFile(pathToFile);
          const repoCommitsFileSize = fs.statSync(pathToFile).size;
          if (repoCommitsFileSize > largestRepoCommitsFileSize) {
            largestRepoCommitsFileSize = repoCommitsFileSize;
            largestRepoCommitsFileName = `${ownerDir}/${file}`;
          }
          totalRepoCommitsSize += repoCommitsFileSize;
        }
      }
    }
    console.log(data.repoCommits);
    console.log(`  largest: ${largestRepoCommitsFileName} (${toKB(largestRepoCommitsFileSize)})`);
    console.log(`  total: ${toMB(totalRepoCommitsSize)}`);

    let numOrgs = 0;
    let largestOrgFileName;
    let largestOrgFileSize = 0;
    let totalOrgSize = 0;
    for (const file of fs.readdirSync(data.orgs)) {
      if (file.endsWith('.json')) {
        const pathToFile = path.join(data.orgs, file);
        const org = new DbFile(pathToFile);
        ++numOrgs;
        const orgFileSize = fs.statSync(pathToFile).size;
        if (orgFileSize > largestOrgFileSize) {
          largestOrgFileSize = orgFileSize;
          largestOrgFileName = file;
        }
        totalOrgSize += orgFileSize;
      }
    }
    console.log(data.orgs);
    console.log(`  ${numOrgs} orgs`);
    console.log(`  largest: ${largestOrgFileName} (${largestOrgFileSize} B)`);
    console.log(`  total: ${toKB(totalOrgSize)}`);

    const nonOrgsSize = fs.statSync(data.nonOrgs).size;
    console.log(`${data.nonOrgs}: ${toKB(nonOrgsSize)}`);

    const metaSize = fs.statSync(data.meta).size;
    console.log(`${data.meta}: ${metaSize} B`);

    const totalSize = totalUserSize + totalContribSize + totalRepoSize + totalRepoCommitsSize +
                      totalOrgSize + nonOrgsSize + metaSize;
    console.log(`total: ${toMB(totalSize)}`);

    console.log(`\n=> ${toKB(totalSize / numUsers)}/user`);

    return;

    function toKB(bytes) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    function toMB(bytes) {
      return `${Math.round(bytes / 1024 / 1024)} MB`;
    }
  }

})();
