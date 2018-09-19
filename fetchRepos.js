#!/usr/bin/env node
'use strict';

(async () => {

  const assert = require('assert');
  const fs = require('fs');
  const meow = require('meow');
  const Mode = require('stat-mode');
  const ora = require('ora');
  const path = require('path');

  const DbFile = require('./impl/dbFile');
  const fetchJson = require('./impl/fetchJson');
  const github = require('./impl/github');
  const githubColors = require('github-colors');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  const cli = meow(`
Update data/repos/**/*.json

usage:
  $ ./fetchRepos.js [--data PATH] [--firsttime]
  $ ./fetchRepos.js --help
  $ ./fetchRepos.js --version

optional arguments:
  --data PATH    Path to the folder containing all the json files (default: data/)
  --firsttime    Fetch only repos that have never been fetched before
`, {
    boolean: [
      'firsttime',
    ],
    string: [
      'data',
    ],
  });

  if (cli.input.length > 0) {
    console.error('Error: positional arguments are not supported. See `./fetchRepos.js --help`.');
    process.exit(1);
  }

  await fetchRepos(cli.flags.data || 'data/', cli.flags.firsttime);
  return;

  async function fetchRepos(pathToData, firsttime) {
    let spinner;
    const setSpinnerTextAndRender = (() => {
      let lastRender = new Date;
      return text => {
        spinner.text = text;
        const now = new Date;
        if (now - lastRender >= 1000) {
          lastRender = now;
          spinner.render();
        }
      };
    })();

    const pathToUsers = path.join(pathToData, 'users');
    let spinnerText = 'Reading users from DB...';
    spinner = ora(spinnerText).start();
    const users = [];
    for (const file of fs.readdirSync(pathToUsers)) {
      if (file.endsWith('.json')) {
        const user = new DbFile(path.join(pathToUsers, file));
        if (!user.ghuser_deleted_because) {
          users.push(user);
          setSpinnerTextAndRender(`${spinnerText} [${users.length}]`);
        }
      }
    }
    spinner.succeed(`Found ${users.length} users in DB`);

    const pathToRepos = path.join(pathToData, 'repos');
    spinnerText = 'Searching repos referenced by users...';
    spinner = ora(spinnerText).start();
    const referencedRepos = new Set([]);
    for (const user of users) {
      for (const repo in (user.contribs && user.contribs.repos || [])) {
        const full_name = user.contribs.repos[repo];
        if (!full_name) {
          throw `user.contribs.repos[${repo}] is undefined`;
        }
        referencedRepos.add(full_name);
        setSpinnerTextAndRender(`${spinnerText} [${referencedRepos.size}]`);

        // Make sure the corresponding repo file exists:
        (new DbFile(path.join(pathToRepos, `${full_name}.json`))).write();
      }
    }
    spinner.succeed(`Found ${referencedRepos.size} repos referenced by users`);

    spinnerText = 'Reading repos from DB...';
    spinner = ora(spinnerText).start();
    const repoPaths = {};
    for (const ownerDir of fs.readdirSync(pathToRepos)) {
      const pathToOwner = path.join(pathToRepos, ownerDir);
      if ((new Mode(fs.statSync(pathToOwner))).isDirectory()) {
        for (const file of fs.readdirSync(pathToOwner)) {
          const ext = '.json';
          if (file.endsWith(ext)) {
            const pathToRepo = path.join(pathToOwner, file);
            const repo = new DbFile(pathToRepo);
            repo._comment = 'DO NOT EDIT MANUALLY - See ../../../README.md';
            repo.write();
            const full_name = `${ownerDir}/${file}`.slice(0, -ext.length);
            repoPaths[full_name] = pathToRepo;
            setSpinnerTextAndRender(`${spinnerText} [${Object.keys(repoPaths).length}]`);
          }
        }
      }
    }
    spinner.succeed(`Found ${Object.keys(repoPaths).length} repos in DB`);

    for (const repoFullName of referencedRepos) {
      await fetchRepo(repoFullName, firsttime);
    }
    stripUnreferencedRepos();

    for (const repoFullName in repoPaths) {
      const repo = new DbFile(repoPaths[repoFullName]);
      if (!repo.removed_from_github && !repo.ghuser_insignificant) {
        await fetchRepoContributors(repo);
        await fetchRepoPullRequests(repo);
        await fetchRepoLanguages(repo);
        await fetchRepoSettings(repo);
        markRepoAsFullyFetched(repo);
      }
    }

    createRenamedRepos();

    return;

    async function fetchRepo(repoFullName, firsttime) {
      const ghRepoUrl = `https://api.github.com/repos/${repoFullName}`;
      spinner = ora(`Fetching ${ghRepoUrl}...`).start();
      const repo = new DbFile(repoPaths[repoFullName]);

      const now = new Date;
      const maxAgeHours = firsttime && (24 * 365) || 12;
      if (repo.fetching_since || repo.fetched_at &&
          now - Date.parse(repo.fetched_at) < maxAgeHours * 60 * 60 * 1000) {
        spinner.succeed(`${repoFullName} is still fresh`);
        return;
      }

      if (repo.removed_from_github) {
        // For now ok, but maybe some day we'll have to deal with resurrected repos.
        spinner.succeed(`${repoFullName} was removed from GitHub in the past`);
        return;
      }

      const ghDataJson = await github.fetchGHJson(ghRepoUrl, spinner, [304, 404, 451],
                                                  new Date(repo.fetched_at));
      switch (ghDataJson) {
      case 304:
        repo.fetched_at = now.toISOString();;
        spinner.succeed(`${repoFullName} didn't change`);
        repo.write();
        return;
      case 404:
        repo.removed_from_github = true;
        spinner.succeed(`${repoFullName} was removed from GitHub`);
        repo.write();
        return;
      case 451: // Unavailable for legal reasons
        // Probably a DCMA takedown, like https://github.com/worktips/worktips
        repo.removed_from_github = true;
        spinner.succeed(`${repoFullName} is blocked for legal reasons`);
        repo.write();
        return;
      }
      repo.fetching_since = now.toISOString();;

      spinner.succeed(`Fetched ${ghRepoUrl}`);

      ghDataJson.owner = ghDataJson.owner.login;
      Object.assign(repo, ghDataJson);

      // Keep the DB small:
      for (const field of [
        "node_id", "keys_url", "collaborators_url", "teams_url", "hooks_url", "issue_events_url",
        "events_url", "assignees_url", "branches_url", "tags_url", "blobs_url", "git_tags_url",
        "git_refs_url", "trees_url", "statuses_url", "contributors_url", "subscribers_url",
        "subscription_url", "commits_url", "git_commits_url", "comments_url", "issue_comment_url",
        "contents_url", "compare_url", "merges_url", "archive_url", "downloads_url", "issues_url",
        "milestones_url", "notifications_url", "labels_url", "releases_url", "deployments_url",
        "ssh_url", "git_url", "clone_url", "svn_url", "has_issues", "has_projects", "has_downloads",
        "has_wiki", "has_pages", "id", "forks_url", "permissions", "allow_squash_merge",
        "allow_merge_commit", "allow_rebase_merge", "stargazers_url", "watchers_count",
        "forks_count", "open_issues_count", "forks", "open_issues", "watchers", "parent", "source",
        "network_count", "subscribers_count"]) {
        delete repo[field];
      }

      // We mark repos without stars or empty as "insignificant" so we don't spend resources on
      // fetching more info about them.
      repo.ghuser_insignificant = repo.stargazers_count < 1 || repo.size === 0;

      repo.write();
    }

    function stripUnreferencedRepos() {
      // Deletes repos that are not referenced by any user's contribution.

      const toBeDeleted = [];
      for (const repoFullName in repoPaths) {
        if (!referencedRepos.has(repoFullName)) {
          toBeDeleted.push(repoFullName);
        }
      }
      for (const repoFullName of toBeDeleted) {
        fs.unlinkSync(repoPaths[repoFullName]);
        delete repoPaths[repoFullName];
      }
    }

    async function fetchRepoContributors(repo) {
      repo.contributors = repo.contributors || {};
      const spinnerText = `Fetching ${repo.full_name}'s contributors...`;
      spinner = ora(spinnerText).start();

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        spinner.succeed(`${repo.full_name} hasn't changed`);
        return;
      }

      // This endpoint only gives us the 100 greatest contributors, so if it looks like there
      // can be more, we use the next endpoint to get the 500 greatest ones:
      let firstMethodFailed = false;
      if (Object.keys(repo.contributors).length < 100) {
        const ghUrl = `https://api.github.com/repos/${repo.full_name}/stats/contributors`;

        let ghDataJson;
        for (let i = 3; i >= 0; --i) {
          ghDataJson = await github.fetchGHJson(ghUrl, spinner);

          if (ghDataJson && Object.keys(ghDataJson).length > 0) {
            break; // worked
          }

          // GitHub is still calculating the stats and we need to wait a bit and try again, see
          // https://developer.github.com/v3/repos/statistics/

          if (!i) {
            // Too many retries. This happens on brand new repos.
            firstMethodFailed = true;
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        if (!firstMethodFailed) {
          for (const contributor of ghDataJson) {
            if (!contributor.author) { // rare but happens
              continue;
            }
            repo.contributors[contributor.author.login] = contributor.total;
          }
        }
      }

      // This endpoint only gives us the 500 greatest contributors, so if it looks like there
      // can be more, we use the next endpoint to get all commits:
      let secondMethodFailed = false;
      if (firstMethodFailed ||
            Object.keys(repo.contributors).length >= 100 &&
            Object.keys(repo.contributors).length < 500) {
        const perPage = 100;
        for (let page = 1; page <= 5; ++page) {
          const ghUrl = `https://api.github.com/repos/${repo.full_name}/contributors?page=${page}&per_page=${perPage}`;
          const ghDataJson = await github.fetchGHJson(ghUrl, spinner, [403]);
          if (ghDataJson === 403) {
            // This happens for huge repos like https://github.com/StefanescuCristian/ubuntu-bfsq ,
            // for which even GitHub's UI says that the number of contributors is infinite.
            secondMethodFailed = true;
            break;
          }

          for (const contributor of ghDataJson) {
            repo.contributors[contributor.login] = contributor.contributions;
          }

          if (ghDataJson.length < perPage) {
            break;
          }
        }
      }

      if (secondMethodFailed || Object.keys(repo.contributors).length >= 500) {
        const contributors = {};
        const perPage = 100;
        for (let page = 1;; ++page) {
          spinner.start(`${spinnerText} [commit page ${page}]`);
          const ghUrl = `https://api.github.com/repos/${repo.full_name}/commits?page=${page}&per_page=${perPage}`;
          const ghDataJson = await github.fetchGHJson(ghUrl, spinner);
          for (const commit of ghDataJson) {
            const author_login = commit.author && commit.author.login;
            const committer_login = commit.committer && commit.committer.login;
            if (author_login) {
              if (!(author_login in contributors)) {
                contributors[author_login] = 0;
              }
              ++contributors[author_login];
            }
            if (committer_login && committer_login !== author_login) {
              if (!(committer_login in contributors)) {
                contributors[committer_login] = 0;
              }
              ++contributors[committer_login];
            }
          }

          if (ghDataJson.length < perPage) {
            break;
          }

          if (page >= 10000) {
            spinner.fail();
            throw 'fetchRepoContributors(): Infinite loop?';
          }
        }

        Object.assign(repo.contributors, contributors);
      }

      spinner.succeed(`Fetched ${repo.full_name}'s contributors`);
      repo.write();
    }

    async function fetchRepoPullRequests(repo) {
      spinner = ora(`Fetching ${repo.full_name}'s pull requests...`).start();

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        spinner.succeed(`${repo.full_name} hasn't changed`);
        return;
      }

      const authors = new Set(repo.pulls_authors || []);

      const pullsUrlSuffix = '{/number}';
      assert(repo.pulls_url.endsWith(pullsUrlSuffix));
      const pullsUrl = repo.pulls_url.slice(0, -pullsUrlSuffix.length);

      const perPage = 100;
      for (let page = 1;; ++page) {
        const ghUrl = `${pullsUrl}?state=all&page=${page}&per_page=${perPage}`;
        const ghDataJson = await github.fetchGHJson(ghUrl, spinner);
        for (const pr of ghDataJson) {
          authors.add(pr.user.login);
        }

        if (ghDataJson.length < perPage) {
          break;
        }

        // They are sorted from newest to oldest in ghDataJson by default:
        if (ghDataJson.length > 0 &&
              new Date(repo.fetched_at) >
              new Date(ghDataJson[ghDataJson.length - 1].created_at)) {
          break;
        }

        if (page >= 10000) {
          spinner.fail();
          throw 'fetchRepoPullRequests(): Infinite loop?';
        }
      }

      spinner.succeed(`Fetched ${repo.full_name}'s pull requests`);

      repo.pulls_authors = [...authors];
      repo.write();
    }

    async function fetchRepoLanguages(repo) {
      const ghUrl = `https://api.github.com/repos/${repo.full_name}/languages`;
      spinner = ora(`Fetching ${ghUrl}...`).start();

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        spinner.succeed(`${repo.full_name} hasn't changed`);
        return;
      }

      const ghDataJson = await github.fetchGHJson(ghUrl, spinner);
      spinner.succeed(`Fetched ${ghUrl}`);

      for (let language in ghDataJson) {
        ghDataJson[language] = {
          bytes: ghDataJson[language],
          color: githubColors.get(language, true).color
        };
      }

      repo.languages = ghDataJson;
      repo.write();
    }

    async function fetchRepoSettings(repo) {
      spinner = ora(`Fetching ${repo.full_name}'s settings...`).start();

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        spinner.succeed(`${repo.full_name} hasn't changed`);
        return;
      }

      for (const fileName of ['.ghuser.io.json', '.github/ghuser.io.json']) {
        const url = `https://rawgit.com/${repo.full_name}/master/${fileName}`;
        const dataJson = await fetchJson(url, spinner, [404]);
        if (dataJson == 404) {
          continue;
        }

        spinner.succeed(`Fetched ${repo.full_name}'s settings`);
        repo.settings = dataJson;
        repo.write();
        return;
      }

      spinner.succeed(`${repo.full_name} has no settings`);
    }

    function markRepoAsFullyFetched(repo) {
      if (repo.fetching_since) {
        repo.fetched_at = repo.fetching_since;
        delete repo.fetching_since;
        repo.write();
      }
    }

    function createRenamedRepos() {
      // Some repos got renamed/moved after the latest contributions and need to be created as well
      // with their new name, so they can be found by the frontend.

      for (const repoOldFullName in repoPaths) {
        const repoPath = repoPaths[repoOldFullName];
        const repo = new DbFile(repoPaths[repoOldFullName]);
        if (repo.removed_from_github) {
          continue;
        }

        const repoLatestFullName = repo.full_name;
        if (!repoLatestFullName) {
          throw `${repoOldFullName} has no full name`;
        }

        if (repoOldFullName !== repoLatestFullName && !repoPaths[repoLatestFullName]) {
          const newRepoPath = path.join(pathToRepos, `${repoLatestFullName}.json`);

          // Will create the folder if needed:
          (new DbFile(newRepoPath)).write();

          fs.copyFileSync(repoPath, newRepoPath);
          repoPaths[repoLatestFullName] = newRepoPath;
        }
      }
    }
  }

})();
