#!/usr/bin/env node
'use strict';

(async () => {

  const fs = require('fs');
  const ora = require('ora');
  const path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const github = require('./impl/github');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  await fetchOrgs();
  return;

  async function fetchOrgs() {
    let spinner;

    // In this file we store repo owners that we know aren't organizations. This avoids querying
    // them next time.
    const nonOrgs = new DbFile(data.nonOrgs);
    nonOrgs.non_orgs = nonOrgs.non_orgs || [];

    const users = [];
    for (const file of fs.readdirSync(data.users)) {
      if (file.endsWith('.json')) {
        const user = new DbFile(path.join(data.users, file));
        if (!user.ghuser_deleted_because && !user.removed_from_github) {
          users.push(user);
        }
      }
    }

    let userOrgs = new Set([]);
    for (const user of users) {
      userOrgs = new Set([...userOrgs, ...user.organizations]);
    }
    await fetchOrgs(userOrgs);

    let contribOwners = new Set([]);
    for (const user of users) {
      contribOwners = new Set([
        ...contribOwners,
        ...(user.contribs && user.contribs.repos.map(repo => repo.split('/')[0]) || [])
      ]);
    }
    await fetchOrgs(contribOwners);

    stripUnreferencedOrgs();

    return;

    async function fetchOrgs(owners) {
      owners:
      for (const owner of owners) {
        spinner = ora(`Fetching owner ${owner}...`).start();
        const org = new DbFile(path.join(data.orgs, `${owner}.json`));
        if (org.avatar_url) {
          spinner.succeed(`Organization ${owner} is already known`);
          continue;
        }
        if (nonOrgs.non_orgs.indexOf(owner) !== -1) {
          spinner.succeed(`${owner} is a user`);
          continue;
        }
        for (const user of users) {
          if (user.login === owner) {
            spinner.succeed(`${owner} is a user`);
            nonOrgs.non_orgs.push(owner);
            nonOrgs.write();
            continue owners;
          }
        }

        const orgUrl = `https://api.github.com/orgs/${owner}`;
        const orgJson = await github.fetchGHJson(orgUrl, spinner, [404]);
        if (orgJson === 404) {
          spinner.succeed(`${owner} must be a user`);
          nonOrgs.non_orgs.push(owner);
          nonOrgs.write();
          continue;
        }
        spinner.succeed(`Fetched organization ${owner}`);

        Object.assign(org, orgJson);

        // Keep the DB small:
        delete org.id;
        delete org.node_id;
        delete org.events_url;
        delete org.hooks_url;
        delete org.issues_url;
        delete org.repos_url;
        delete org.members_url;
        delete org.public_members_url;
        delete org.description;
        delete org.company;
        delete org.blog;
        delete org.location;
        delete org.email;
        delete org.has_organization_projects;
        delete org.has_repository_projects;
        delete org.public_repos;
        delete org.public_gists;
        delete org.followers;
        delete org.following;
        delete org.is_verified;
        delete org.total_private_repos;
        delete org.owned_private_repos;
        delete org.private_gists;
        delete org.disk_usage;
        delete org.billing_email;
        delete org.plan;
        delete org.default_repository_permission;
        delete org.members_can_create_repositories;
        delete org.two_factor_requirement_enabled;

        org.write();
      }
    }

    function stripUnreferencedOrgs() {
      // Deletes orgs that are not referenced by any user.

      for (const file of fs.readdirSync(data.orgs)) {
        const ext = '.json';
        if (file.endsWith(ext)) {
          const orgName = file.slice(0, -ext.length);
          if (!userOrgs.has(orgName) && !contribOwners.has(orgName)) {
            fs.unlinkSync(path.join(data.orgs, file));
          }
        }
      }
    }
  }

})();
