#!/usr/bin/env node
'use strict';

(async () => {

  const fs = require('fs');
  const meow = require('meow');
  const ora = require('ora');
  const path = require('path');
  const sleep = require('await-sleep');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const fetchJson = require('./impl/fetchJson');

  const ghclV3 = require(`./impl/githubV3`);
  const ghclV4 = require(`./impl/githubV4`);

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
    console.log('Reading users from DB...')
    const users = [];
    for (const file of fs.readdirSync(data.users)) {
      await sleep(0); // make loop interruptible

      if (file.endsWith('.json')) {
        const user = new DbFile(path.join(data.users, file));
        if (!user.ghuser_deleted_because && !user.removed_from_github) {
          users.push(user);
        }
      }
    }
    console.log(`Found ${users.length} users in DB`);

    console.log('Searching repos referenced by users...');
    const referencedRepos = new Set([]);
    for (const user of users) {
      for (const repo in (user.contribs && user.contribs.repos || [])) {
        await sleep(0); // make loop interruptible

        const full_name = user.contribs.repos[repo];
        if (!full_name) {
          throw `user.contribs.repos[${repo}] is undefined`;
        }
        referencedRepos.add(full_name);
        // Make sure the corresponding repo files exist:
        for (const pathToFolder of [data.repos, data.repoCommits]) {
          const filePath = path.join(pathToFolder, `${full_name}.json`);
          fs.existsSync(filePath) || (new DbFile(filePath)).write();
        }
      }
    }
    console.log(`Found ${referencedRepos.size} repos referenced by users`);

    console.log('Reading repos from DB...');
    const reposInDb = new Set([]);
    for (const ownerDir of fs.readdirSync(data.repos)) {
      const pathToOwner = path.join(data.repos, ownerDir);
      for (const file of fs.readdirSync(pathToOwner)) {
        await sleep(0); // make loop interruptible

        const ext = '.json';
        if (file.endsWith(ext)) {
          const fullName = `${ownerDir}/${file}`.slice(0, -ext.length);
          reposInDb.add(fullName);
        }
      }
    }
    console.log(`Found ${Object.keys(repoPaths).length} repos in DB`);

    stripUnreferencedRepos();

    let full_names;

    full_names = [...referencedRepos];
    await Promise.all([
      loopDo(full_names, async (full_name) => { await fetchRepo(ghclV3, full_name, firsttime)}),
      loopDo(full_names, async (full_name) => { await fetchRepo(ghclV4, full_name, firsttime)}),
    ]);

    full_names = [...reposInDb];
    await Promise.all([
      loopDo(full_names, async (full_name) => { await fetchRepoDetails(ghclV3, repoPaths(full_name))}),
      loopDo(full_names, async (full_name) => { await fetchRepoDetails(ghclV4, repoPaths(full_name))}),
    ]);

    createRenamedRepos();

    return;

    async function fetchRepoDetails(ghcl, paths) {
      const repo = new DbFile(paths.repo);
      if (!repo.removed_from_github && !repo.ghuser_insignificant) {
        const repoCommits = new DbFile(paths.repoCommits);
        await fetchRepoCommitsAndContributors(ghcl, repo, repoCommits);
        await fetchRepoPullRequests(ghcl, repo);
        await fetchRepoLanguages(ghcl, repo);
        await fetchRepoSettings(repo);
      }
      markRepoAsFullyFetched(repo);
    }

    async function fetchRepo(ghcl, repoFullName, firsttime) {
      const tag = `[${ghcl.version}] Fetch Repo - ${repoFullName} -`;

      console.log(`${tag} starting`);
      const repo = new DbFile(repoPaths(repoFullName).repo);

      const now = new Date;
      const maxAgeHours = firsttime && (24 * 365) || 12;
      if (repo.fetching_since || repo.fetched_at &&
          now - Date.parse(repo.fetched_at) < maxAgeHours * 60 * 60 * 1000) {
        console.log(`${tag} is still fresh`);
        return;
      }

      if (repo.removed_from_github) {
        // For now ok, but maybe some day we'll have to deal with resurrected repos.
        console.log(`${tag} was removed from GitHub in the past`);
        return;
      }

      const ghDataJson = await ghcl.repo([304, 403, 404, 451], repoFullName,
                                         new Date(repo.fetched_at));

      switch (ghDataJson) {
      case 304:
        repo.fetched_at = now.toISOString();
        console.log(`${tag} didn't change`);
        repo.write();
        return;

      case 404:
        repo.removed_from_github = true;
        console.log(`${tag} was removed from GitHub`);
        repo.write();
        return;

       // Unavailable for legal reasons:
      case 451: // Probably a DCMA takedown, like https://github.com/worktips/worktips
      case 403: // Probably not respecting the Terms of Service, like https://github.com/Kwoth/NadekoBot
        repo.removed_from_github = true;
        console.log(`${tag} is blocked for legal reasons`);
        repo.write();
        return;
      }

      repo.fetching_since = now.toISOString();

      console.log(`${tag} finished`);

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
      for (const repoFullName of reposInDb) {
        if (!referencedRepos.has(repoFullName)) {
          toBeDeleted.push(repoFullName);
        }
      }
      for (const repoFullName of toBeDeleted) {
        fs.unlinkSync(repoPaths(repoFullName).repo);
        try {
          fs.unlinkSync(repoPaths(repoFullName).repoCommits);
        } catch (e) {
          if (e.code !== 'ENOENT') {
            throw e;
          }
        }
        reposInDb.delete(repoFullName);
      }
    }

    async function fetchRepoCommitsAndContributors(ghcl, repo, repoCommits) {
      const tag = `[${ghcl.version}] Fetch Commits & Contribs - ${repo.full_name} -`;

      repo.contributors = repo.contributors || {};
      repoCommits.contributors = repoCommits.contributors || {};
      repoCommits.last_fetched_commit = repoCommits.last_fetched_commit || {
        sha: null,
        date: '2000-01-01T00:00:00Z'
      };

      console.log(`${tag} starting`);

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {

        if (repo.size && !repoCommits.last_fetched_commit.sha) {
          // This is fishy because the repo isn't empty but we didn't manage to fetch any commit
          // last time. We definitely need to try again.
        } else {
          console.log(`${tag} hasn't changed`);
          return;
        }

      }

      const now = new Date;
      let mostRecentCommit;
      let ghAPIV4Cursor;
      const perPage = 100;
      pages:
      for (let page = 1;; ++page) {
        console.log(`${tag} [page ${page}]`);
        const ghDataJson = await ghcl.commits([404, 500], repo.full_name, repoCommits.last_fetched_commit.date, page, perPage, ghAPIV4Cursor);
        ghAPIV4Cursor = ghDataJson[0] ? ghDataJson[0].cursor : undefined;

        switch (ghDataJson) {
        case 404:
          // The repo has been removed during the current run. It will be marked as removed in the
          // next run. For now just don't crash.
          console.log(`${tag} was just removed from GitHub`);
          return;
        case 500: // Workaround for #8
          if (page > 1000) {
            // It would be a pity to lose all this work. Mark as truncated and move on:
            repoCommits.ghuser_truncated = true;
            break pages;
          }
          console.log(`${tag} failed`);
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

        if (page >= 500) {
          // Extreme example is https://github.com/KenanSulayman/heartbeat , 1.6 million commits but
          // no single line of code:
          const notPopular = repo.stargazers_count < 15;

          const yearsOfInactivity = (now - Date.parse(mostRecentCommit.date)) /
                                    (365.25 * 24 * 60 * 60 * 1000);

          // Giant old not-so-popular repo, probably a copy of someone else's work with a few
          // patches on top of it:
          const oldAndNotSoPopular = yearsOfInactivity >= 1 &&
                                     repo.stargazers_count / 15 < yearsOfInactivity;

          if (notPopular || oldAndNotSoPopular) {
            // We don't want to waste resources on it for now, see #10
            repoCommits.ghuser_truncated = true;
            break;
          }
        }

        if (page >= 10000) {
          console.log(`${tag} failed`);
          throw 'fetchRepoCommitsAndContributors(): Infinite loop?';
        }
      }

      console.log(`${tag} finished`);

      repo.write();
      repoCommits.last_fetched_commit = mostRecentCommit || repoCommits.last_fetched_commit;
      repoCommits.write();

      if (repo.size && !repoCommits.last_fetched_commit.sha) {
        throw `${repo.full_name} is not empty yet has no commits?`;
      }
    }

    async function fetchRepoPullRequests(ghcl, repo) {
      const tag = `[${ghcl.version}] Fetch PRs - ${repo.full_name} -`;

      console.log(`${tag} starting`);

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        console.log(`${tag} hasn't changed`);
        return;
      }

      const authors = new Set(repo.pulls_authors || []);

      let ghAPIV4Cursor;
      const perPage = 100;
      for (let page = 1;; ++page) {
        const ghDataJson = await ghcl.pullRequests([404, 500, 502], repo.full_name, page, perPage,
                                                   ghAPIV4Cursor);
        ghAPIV4Cursor = ghDataJson[0] ? ghDataJson[0].cursor : undefined;

        switch (ghDataJson) {
        case 404:
          // The repo has been removed during the current run. It will be marked as removed in the
          // next run. For now just don't crash.
          console.log(`${tag} was just removed from GitHub`);
          return;
        case 502:
          // About twice per month we hit 502 'Server Error', often on repo
          // everypolitician/everypolitician-data, so let's not crash and move on, even if this
          // means that we'll miss some pull requests sometimes.
        case 500: // Workaround for #8
          console.log(`${tag} failed`);
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
          console.log(`${tag} failed`);
          throw 'fetchRepoPullRequests(): Infinite loop?';
        }
      }

      console.log(`${tag} finished`);

      repo.pulls_authors = [...authors];
      repo.write();
    }

    async function fetchRepoLanguages(ghcl, repo) {
      const tag = `[${ghcl.version}] Fetch Languages - ${repo.full_name} -`;

      console.log(`${tag} starting`);

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        console.log(`${tag} hasn't changed`);
        return;
      }

      const ghDataJson = await ghcl.repoLanguages([404], repo.full_name);
      if (ghDataJson === 404) {
        // The repo has been removed during the current run. It will be marked as removed in the
        // next run. For now just don't crash.
        console.log(`${tag} was just removed from GitHub`);
        return;
      }

      console.log(`${tag} finished`);

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
      const tag = `Fetch Settings - ${repo.full_name} -`;

      console.log(`${tag} starting`);

      if (!repo.fetching_since || repo.fetched_at &&
          new Date(repo.fetched_at) > new Date(repo.pushed_at)) {
        console.log(`${tag} hasn't changed`);
        return;
      }

      for (const fileName of ['.ghuser.io.json', '.github/ghuser.io.json']) {
        const url = `https://raw.githubusercontent.com/${repo.full_name}/master/${fileName}`;
        const dataJson = await fetchJson(url, null, [404]);
        if (dataJson === 404) {
          continue;
        }

        console.log(`${tag} finished`);
        repo.settings = dataJson;
        repo.write();
        return;
      }

      console.log(`${tag} has no settings`);
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

      for (const repoOldFullName of reposInDb) {
        const repo = new DbFile(repoPaths(repoOldFullName).repo);
        if (repo.removed_from_github) {
          continue;
        }

        const repoLatestFullName = repo.full_name;
        if (!repoLatestFullName) {
          throw `${repoOldFullName} has no full name`;
        }

        if (repoOldFullName !== repoLatestFullName && !reposInDb.has(repoLatestFullName)) {
          reposInDb.add(repoLatestFullName);

          // Will create the folders if needed:
          (new DbFile(repoPaths(repoLatestFullName).repo)).write();
          (new DbFile(repoPaths(repoLatestFullName).repoCommits)).write();

          fs.copyFileSync(repoPaths(repoOldFullName).repo, repoPaths(repoLatestFullName).repo);
          fs.copyFileSync(repoPaths(repoOldFullName).repoCommits, repoPaths(repoLatestFullName).repoCommits);
        }
      }
    }

    function repoPaths(fullName) {
      return {
        repo: path.join(data.repos, `${fullName}.json`),
        repoCommits: path.join(data.repoCommits, `${fullName}.json`)
      };
    }
  }

})();

const loopDo = async (jobs, jobFn) => {
  while(true) {
    const job = jobs.pop();

    if (!job) {
      break
    }

    await jobFn(job);
  }
};
