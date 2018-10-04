#!/usr/bin/env node
'use strict';

(async () => {

  const assert = require('assert');
  const fs = require('fs');
  const meow = require('meow');
  const ora = require('ora');
  const path = require('path');
  const sleep = require('await-sleep');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const fetchJson = require('./impl/fetchJson');
  const github = require('./impl/github');
  const githubColors = require('github-colors');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  const cli = meow(`
Update ${path.join(data.root, 'repo')}*/**/*.json

usage:
  $ ./fetchRepos.js [--firsttime]
  $ ./fetchRepos.js --help
  $ ./fetchRepos.js --version

optional arguments:
  --firsttime    Fetch only repos that have never been fetched before
`, {
    boolean: [
      'firsttime',
    ],
  });

  if (cli.input.length > 0) {
    console.error('Error: positional arguments are not supported. See `./fetchRepos.js --help`.');
    process.exit(1);
  }

  await fetchRepos(cli.flags.firsttime);
  return;

  async function fetchRepos(firsttime) {
    let spinner;

    let spinnerText = 'Reading users from DB...';
    spinner = ora(spinnerText).start();
    const users = [];
    for (const file of fs.readdirSync(data.users)) {
      await sleep(0); // make loop interruptible

      if (file.endsWith('.json')) {
        const user = new DbFile(path.join(data.users, file));
        if (!user.ghuser_deleted_because && !user.removed_from_github) {
          users.push(user);
          spinner.text = `${spinnerText} [${users.length}]`;
        }
      }
    }
    spinner.succeed(`Found ${users.length} users in DB`);

    spinnerText = 'Searching repos referenced by users...';
    spinner = ora(spinnerText).start();
    const referencedRepos = new Set([]);
    for (const user of users) {
      for (const repo in (user.contribs && user.contribs.repos || [])) {
        await sleep(0); // make loop interruptible

        const full_name = user.contribs.repos[repo];
        if (!full_name) {
          throw `user.contribs.repos[${repo}] is undefined`;
        }
        referencedRepos.add(full_name);
        spinner.text = `${spinnerText} [${referencedRepos.size}]`;

        // Make sure the corresponding repo files exist:
        for (const pathToFolder of [data.repos, data.repoCommits]) {
          const filePath = path.join(pathToFolder, `${full_name}.json`);
          fs.existsSync(filePath) || (new DbFile(filePath)).write();
        }
      }
    }
    spinner.succeed(`Found ${referencedRepos.size} repos referenced by users`);

    spinnerText = 'Reading repos from DB...';
    spinner = ora(spinnerText).start();
    const repoPaths = {};
    for (const ownerDir of fs.readdirSync(data.repos)) {
      const pathToOwner = path.join(data.repos, ownerDir);
      for (const file of fs.readdirSync(pathToOwner)) {
        await sleep(0); // make loop interruptible

        const ext = '.json';
        if (file.endsWith(ext)) {
          const full_name = `${ownerDir}/${file}`.slice(0, -ext.length);
          repoPaths[full_name] = {
            repo: path.join(pathToOwner, file),
            repoCommits: path.join(data.repoCommits, ownerDir, file)
          };
          spinner.text = `${spinnerText} [${Object.keys(repoPaths).length}]`;
        }
      }
    }
    spinner.succeed(`Found ${Object.keys(repoPaths).length} repos in DB`);

    for (const repoFullName of referencedRepos) {
      await fetchRepo(repoFullName, firsttime);
    }
    stripUnreferencedRepos();

    for (const repoFullName in repoPaths) {
      const repo = new DbFile(repoPaths[repoFullName].repo);
      if (!repo.removed_from_github && !repo.ghuser_insignificant) {
        const repoCommits = new DbFile(repoPaths[repoFullName].repoCommits);
        await fetchRepoCommitsAndContributors(repo, repoCommits);
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
      const repo = new DbFile(repoPaths[repoFullName].repo);

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
        'node_id', 'keys_url', 'collaborators_url', 'teams_url', 'hooks_url', 'issue_events_url',
        'events_url', 'assignees_url', 'branches_url', 'tags_url', 'blobs_url', 'git_tags_url',
        'git_refs_url', 'trees_url', 'statuses_url', 'contributors_url', 'subscribers_url',
        'subscription_url', 'commits_url', 'git_commits_url', 'comments_url', 'issue_comment_url',
        'contents_url', 'compare_url', 'merges_url', 'archive_url', 'downloads_url', 'issues_url',
        'milestones_url', 'notifications_url', 'labels_url', 'releases_url', 'deployments_url',
        'ssh_url', 'git_url', 'clone_url', 'svn_url', 'has_issues', 'has_projects', 'has_downloads',
        'has_wiki', 'has_pages', 'id', 'forks_url', 'permissions', 'allow_squash_merge',
        'allow_merge_commit', 'allow_rebase_merge', 'stargazers_url', 'watchers_count',
        'forks_count', 'open_issues_count', 'forks', 'open_issues', 'watchers', 'parent', 'source',
        'network_count', 'subscribers_count']) {
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
        fs.unlinkSync(repoPaths[repoFullName].repo);
        fs.unlinkSync(repoPaths[repoFullName].repoCommits);
        delete repoPaths[repoFullName];
      }
    }

    async function fetchRepoCommitsAndContributors(repo, repoCommits) {
      repo.contributors = repo.contributors || {};
      repoCommits.contributors = repoCommits.contributors || {};
      repoCommits.last_fetched_commit = repoCommits.last_fetched_commit || {
        sha: null,
        date: '2000-01-01T00:00:00Z'
      };

      const spinnerText = `Fetching ${repo.full_name}'s commits...`;
      spinner = ora(spinnerText).start();

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        spinner.succeed(`${repo.full_name} hasn't changed`);
        return;
      }

      const now = new Date;
      let mostRecentCommit;
      const perPage = 100;
      pages:
      for (let page = 1;; ++page) {
        spinner.start(`${spinnerText} [page ${page}]`);
        const ghUrl = `https://api.github.com/repos/${repo.full_name}/commits?since=${repoCommits.last_fetched_commit.date}&page=${page}&per_page=${perPage}`;
        const ghDataJson = await github.fetchGHJson(ghUrl, spinner, [404, 500]);
        switch (ghDataJson) {
        case 404:
          // The repo has been removed during the current run. It will be marked as removed in the
          // next run. For now just don't crash.
          spinner.succeed(`${repo.full_name} was just removed from GitHub`);
          return;
        case 500: // Workaround for #8
          if (page > 1000) {
            // It would be a pity to lose all this work. Mark as truncated and move on:
            repoCommits.ghuser_truncated = true;
            break pages;
          }
          spinner.fail();
          return;
        }

        for (const commit of ghDataJson) {
          if (commit.sha === repoCommits.last_fetched_commit.sha) {
            break pages; // we know already this commit and all the following ones
          }

          mostRecentCommit = mostRecentCommit || {
            sha: commit.sha,
            date: commit.author && commit.commit.author.date || commit.commit.committer.date
          };

          const author_login = commit.author && commit.author.login;
          const committer_login = commit.committer && commit.committer.login;
          if (author_login) {
            storeCommit(author_login, commit.commit.author.date);
          }
          if (committer_login && committer_login !== author_login) {
            storeCommit(committer_login, commit.commit.committer.date);
          }

          function storeCommit(login, date) {
            if (!(login in repoCommits.contributors)) {
              repo.contributors[login] = 0;
              repoCommits.contributors[login] = {};
            }
            ++repo.contributors[login];
            const day = date.substring(0, 10);
            if (!(day in repoCommits.contributors[login])) {
              repoCommits.contributors[login][day] = 0;
            }
            ++repoCommits.contributors[login][day];
          }
        }

        if (ghDataJson.length < perPage) {
          break;
        }

        const yearsOfInactivity = (now - Date.parse(mostRecentCommit.date)) /
                                  (365.25 * 24 * 60 * 60 * 1000);
        if (page >= 500 && yearsOfInactivity >= 1
            && repo.stargazers_count / 15 < yearsOfInactivity) {
          // Giant old not-so-popular repo, probably a copy of someone else's work with a few
          // patches on top of it. We don't want to waste resources on it for now, see #10
          repoCommits.ghuser_truncated = true;
          break;
        }

        if (page >= 10000) {
          spinner.fail();
          throw 'fetchRepoCommitsAndContributors(): Infinite loop?';
        }
      }

      spinner.succeed(`Fetched ${repo.full_name}'s commits`);

      repo.write();
      repoCommits.last_fetched_commit = mostRecentCommit || repoCommits.last_fetched_commit;
      repoCommits.write();
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
        const ghDataJson = await github.fetchGHJson(ghUrl, spinner, [404, 500]);
        switch (ghDataJson) {
        case 404:
          // The repo has been removed during the current run. It will be marked as removed in the
          // next run. For now just don't crash.
          spinner.succeed(`${repo.full_name} was just removed from GitHub`);
          return;
        case 500: // Workaround for #8
          spinner.fail();
          return;
        }

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

      const ghDataJson = await github.fetchGHJson(ghUrl, spinner, [404]);
      if (ghDataJson === 404) {
        // The repo has been removed during the current run. It will be marked as removed in the
        // next run. For now just don't crash.
        spinner.succeed(`${repo.full_name} was just removed from GitHub`);
        return;
      }

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
        const dataJson = await fetchJson(url, spinner, [403, 404]);
        if (dataJson === 403 || // happens on https://rawgit.com/hjnilsson/country-flags/master/.ghuser.io.json , not sure why
            dataJson === 404) {
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
        const repo = new DbFile(repoPaths[repoOldFullName].repo);
        if (repo.removed_from_github) {
          continue;
        }

        const repoLatestFullName = repo.full_name;
        if (!repoLatestFullName) {
          throw `${repoOldFullName} has no full name`;
        }

        if (repoOldFullName !== repoLatestFullName && !repoPaths[repoLatestFullName]) {
          repoPaths[repoLatestFullName] = {
            repo: path.join(data.repos, `${repoLatestFullName}.json`),
            repoCommits: path.join(data.repoCommits, `${repoLatestFullName}.json`)
          };

          // Will create the folders if needed:
          (new DbFile(repoPaths[repoLatestFullName].repo)).write();
          (new DbFile(repoPaths[repoLatestFullName].repoCommits)).write();

          fs.copyFileSync(repoPaths[repoOldFullName].repo, repoPaths[repoLatestFullName].repo);
          fs.copyFileSync(repoPaths[repoOldFullName].repoCommits, repoPaths[repoLatestFullName].repoCommits);
        }
      }
    }
  }

})();
