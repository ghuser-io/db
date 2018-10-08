#!/usr/bin/env node
'use strict';

(() => {

  const gh = require('./github');

  const version = "V3";

  const repo = async (errCodes, repoFullName, repoFetchedAtDate) => {
    const ghRepoUrl = `https://api.github.com/repos/${repoFullName}`;
    return await gh.fetchGHJson(ghRepoUrl, null, errCodes, repoFetchedAtDate);
  };

  const commits = async (errCodes, repoFullName, lastFetchedCommitDateStr, page, perPage) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/commits?since=${lastFetchedCommitDateStr}&page=${page}&per_page=${perPage}`;
    return await gh.fetchGHJson(ghUrl, null, errCodes);
  };

  const pullRequests = async (errCodes, repoFullName, page, perPage) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/pulls?state=all&page=${page}&per_page=${perPage}`;
    return await gh.fetchGHJson(ghUrl, null, errCodes);
  };

  const repoLanguages = async (errCodes, repoFullName) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/languages`;
    return await gh.fetchGHJson(ghUrl, null, errCodes);
  };

  module.exports = {
    version,
    repo,
    commits,
    pullRequests,
    repoLanguages,
  };

})();
