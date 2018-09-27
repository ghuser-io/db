#!/usr/bin/env node
'use strict';

(() => {

  const fs = require('fs');
  const ora = require('ora');
  const path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  calculateContribsAndMeta();
  return;

  function calculateContribsAndMeta() {
    let spinner;

    const orgs = new DbFile(data.orgs);

    const users = {};
    let numUsers = 0;
    for (const file of fs.readdirSync(data.users)) {
      if (file.endsWith('.json')) {
        const user = new DbFile(path.join(data.users, file));
        if (!user.ghuser_deleted_because) {
          users[file] = user;
          ++numUsers;

          // Make sure the corresponding contrib file exists (not the case if it's a new user):
          (new DbFile(path.join(data.contribs, file))).write();
        }
      }
    }

    const contribs = {};
    for (const file of fs.readdirSync(data.contribs)) {
      if (file.endsWith('.json')) {
        const contribList = new DbFile(path.join(data.contribs, file));
        contribList._comment = 'DO NOT EDIT MANUALLY - See ../../README.md';
        contribList.repos = {};
        contribs[file] = contribList;
      }
    }

    const repos = {};
    for (const ownerDir of fs.readdirSync(data.repos)) {
      const pathToOwner = path.join(data.repos, ownerDir);
      for (const file of fs.readdirSync(pathToOwner)) {
        const ext = '.json';
        if (file.endsWith(ext)) {
          const repo = new DbFile(path.join(pathToOwner, file));
          const full_name = `${ownerDir}/${file}`.slice(0, -ext.length);
          repos[full_name] = repo;
        }
      }
    }

    stripUnreferencedContribs();

    let numContribs = 0;
    for (const filename in contribs) {
      numContribs += calculateScores(filename);
      stripInsignificantContribs(filename);
      calculateOrgs(filename);
    }

    const meta = new DbFile(data.meta);
    meta._comment = 'DO NOT EDIT MANUALLY - See ../README.md';
    meta.num_users = numUsers;
    meta.num_contribs = numContribs;
    meta.write();

    return;

    function stripUnreferencedContribs() {
      // Deletes contrib files that aren't referenced by any user.

      const toBeDeleted = [];
      for (const contribList in contribs) {
        if (!users[contribList]) {
          toBeDeleted.push(contribList);
        }
      }
      for (const contribList of toBeDeleted) {
        delete contribs[contribList];
        fs.unlinkSync(path.join(data.contribs, contribList));
      }
    }

    // Calculates all scores for the given user.
    // Returns the number of contributions.
    function calculateScores(filename) {
      const userLogin = users[filename].login;

      spinner = ora(`Calculating scores for ${userLogin}...`).start();

      let numContribs = 0;
      for (const repo of users[filename].contribs.repos) {
        if (!repos[repo]              // repo has been stripped
            || !repos[repo].full_name // repo hasn't been crawled yet
            || repos[repo].removed_from_github
            || repos[repo].ghuser_insignificant
           ) {
          continue;
        }
        ++numContribs;

        const full_name = repos[repo].full_name;
        const score = contribs[filename].repos[full_name] = {
          full_name,
          name: repos[repo].name,
          stargazers_count: repos[repo].stargazers_count,
        };

        let totalContribs = 0;
        for (const contributor in repos[repo].contributors) {
          totalContribs += repos[repo].contributors[contributor];
        }

        score.percentage = repos[repo].contributors && repos[repo].contributors[userLogin] &&
                           100 * repos[repo].contributors[userLogin] / totalContribs || 0;
        score.total_commits_count = totalContribs;
      }

      spinner.succeed(`Calculated scores for ${userLogin}`);
      contribs[filename].write();
      return numContribs;
    }

    function stripInsignificantContribs(filename) {
      // Deletes contributions to forks if the user has done 0%.

      const toBeDeleted = [];
      for (const repo in contribs[filename].repos) {
        const score = contribs[filename].repos[repo];
        if (repos[repo] && repos[repo].fork && score.percentage === 0) {
          toBeDeleted.push(repo);
        }
      }
      for (const repo of toBeDeleted) {
        delete contribs[filename].repos[repo];
      }

      contribs[filename].write();
    }

    function calculateOrgs(filename) {
      contribs[filename].organizations = getContribsOwners(contribs[filename].repos).filter(
        owner => orgs.orgs[owner] && orgs.orgs[owner].login);
      contribs[filename].write();
      return;

      function getContribsOwners(contribRepos) {
        const result = new Set([]);
        for (const repo in contribRepos) {
          if (!contribRepos[repo].percentage) {
            continue;
          }

          const originalOwner = repo.split('/')[0];
          result.add(originalOwner);
          if (contribRepos[repo].full_name) {
            const currentOwner = contribRepos[repo].full_name.split('/')[0];
            result.add(currentOwner);
          }
        }
        return [...result];
      }
    }
  }

})();
