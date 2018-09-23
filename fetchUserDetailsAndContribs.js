#!/usr/bin/env node
'use strict';

(async () => {

  const fs = require('fs');
  const githubContribs = require('@ghuser/github-contribs');
  const meow = require('meow');
  let ora = require('ora');
  let path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const fetchJson = require('./impl/fetchJson');
  const github = require('./impl/github');
  const scriptUtils = require('./impl/scriptUtils');

  const cli = meow(`
usage:
  $ ./fetchUserDetailsAndContribs.js [USER] [--nospin]
  $ ./fetchUserDetailsAndContribs.js --help
  $ ./fetchUserDetailsAndContribs.js --version

positional arguments:
  USER        If specified, fetches only this GitHub username, otherwise fetches all users

optional arguments:
  --nospin    Don't user spinners but classical terminal output instead
`, {
    boolean: [
      'nospin',
    ],
  });

  if (cli.input.length > 1) {
    console.error('Error: too many positional arguments. See `./fetchUserDetailsAndContribs.js --help`.');
    process.exit(1);
  }

  scriptUtils.printUnhandledRejections();

  if (cli.flags.nospin) {
    ora = (text) => ({
      text,
      start(text) {
        this.text = text || this.text;
        console.log(this.text);
        return this;
      },
      stop(text) {
        if (text) {
          this.text = text;
          console.log(this.text);
        }
        return this;
      },
      succeed(text) {
        return this.stop(text);
      },
      warn(text) {
        return this.stop(text);
      },
      fail(text) {
        return this.stop(text);
      },
    });
  }

  if (cli.input.length === 1) {
    await fetchUserDetailsAndContribs(`${cli.input[0].toLowerCase()}.json`);
  } else {
    for (const file of fs.readdirSync(data.users)) {
      if (file.endsWith('.json')) {
        await fetchUserDetailsAndContribs(file);
      }
    }
  }

  return;

  async function fetchUserDetailsAndContribs(userFileName) {
    let spinner;

    const userFilePath = path.join(data.users, userFileName);
    const userFile = new DbFile(userFilePath);
    if (!userFile.login) {
      throw `${userFilePath} is malformed. Did you run ./addUser.js ?`;
    }
    if (userFile.ghuser_deleted_because) {
      console.log(`${userFile.login} has been deleted, skipping...`);
      return;
    }

    await fetchDetails(userFile);
    await fetchOrgs(userFile);
    await fetchContribs(userFile);
    await fetchPopularForks(userFile);
    await fetchSettings(userFile);
    return;

    async function fetchDetails(userFile) {
      const ghUserUrl = `https://api.github.com/users/${userFile.login}`;
      spinner = ora(`Fetching ${ghUserUrl}...`).start();
      const ghDataJson = await github.fetchGHJson(
        ghUserUrl, spinner, [304],
        userFile.contribs && userFile.contribs.fetched_at && new Date(userFile.contribs.fetched_at)
      );
      if (ghDataJson === 304) {
        spinner.succeed(`${userFile.login} didn't change`);
        return;
      }
      spinner.succeed(`Fetched ${ghUserUrl}`);

      Object.assign(userFile, ghDataJson);

      // Keep the DB small:
      for (const field of ["id", "node_id", "gravatar_id", "followers_url", "following_url",
                           "gists_url", "starred_url", "subscriptions_url", "events_url",
                           "received_events_url", "site_admin", "hireable", "public_repos",
                           "followers", "following", "private_gists", "total_private_repos",
                           "owned_private_repos", "disk_usage", "collaborators",
                           "two_factor_authentication", "plan", "url"]) {
        delete userFile[field];
      }

      userFile.write();
    }

    async function fetchOrgs(userFile) {
      const orgsUrl = userFile.organizations_url;
      spinner = ora(`Fetching ${orgsUrl}...`).start();
      const orgsDataJson = await github.fetchGHJson(orgsUrl, spinner);
      spinner.succeed(`Fetched ${orgsUrl}`);

      userFile.organizations = [];
      for (const org of orgsDataJson) {
        userFile.organizations.push(org.login);
      }

      userFile.write();
    }

    async function fetchContribs(userFile) {
      userFile.contribs = userFile.contribs || {
        fetched_at: '2000-01-01T00:00:00.000Z',
        repos: []
      };

      // GitHub users might push today a commit authored for example yesterday, so to be on the safe
      // side we always re-fetch at least the contributions of the last few days before the last
      // time we fetched:
      let since = githubContribs.stringToDate(userFile.contribs.fetched_at);
      for (let i = 0; i < 7; ++i) {
        since = githubContribs.prevDay(since);
      }
      since = githubContribs.dateToString(since);

      const now = new Date;
      const repos = await githubContribs.fetch(userFile.login, since, null, ora);
      for (const repo of repos) {
        if (userFile.contribs.repos.indexOf(repo) === -1) {
          userFile.contribs.repos.push(repo);
        }
      }
      userFile.contribs.fetched_at = now.toISOString();

      userFile.write();
    }

    async function fetchPopularForks(userFile) {
      // fetchUserContribs() won't find forks as they are not considered to be contributions. But
      // the user might well have popular forks.

      spinner = ora(`Fetching ${userFile.login}'s popular forks...`).start();

      const perPage = 100;
      for (let page = 1; page <= 5; ++page) {
        const ghUrl = `${userFile.repos_url}?page=${page}&per_page=${perPage}`;
        const ghDataJson = await github.fetchGHJson(ghUrl, spinner);

        for (const repo of ghDataJson) {
          if (repo.fork && repo.stargazers_count >= 1 &&
              userFile.contribs.repos.indexOf(repo.full_name) === -1) {
            userFile.contribs.repos.push(repo.full_name);
          }
        }

        if (ghDataJson.length < perPage) {
          break;
        }
      }

      spinner.succeed(`Fetched ${userFile.login}'s popular forks`);
      userFile.write();
    }

    async function fetchSettings(userFile) {
      const url = `https://rawgit.com/${userFile.login}/ghuser.io.settings/master/ghuser.io.json`;
      spinner = ora(`Fetching ${userFile.login}'s settings...`).start();

      const dataJson = await fetchJson(url, spinner, [404]);
      if (dataJson == 404) {
        spinner.succeed(`${userFile.login} has no settings`);
        return;
      }
      spinner.succeed(`Fetched ${userFile.login}'s settings`);

      userFile.settings = dataJson;
      userFile.write();
    }
  }

})();
