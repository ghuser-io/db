#!/usr/bin/env node
'use strict';

(() => {

  const gh = require('./github');

  const repo = async (oraSpinner, errCodes, repoFullName, repoFetchedAtDate) => {
    const ghRepoUrl = `https://api.github.com/repos/${repoFullName}`;
    return await gh.fetchGHJson(ghRepoUrl, oraSpinner, errCodes, repoFetchedAtDate);
  };

  const commits = async (oraSpinner, errCodes, repoFullName, lastFetchedCommitDateStr, page, perPage) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/commits?since=${lastFetchedCommitDateStr}&page=${page}&per_page=${perPage}`;
    return await gh.fetchGHJson(ghUrl, oraSpinner, errCodes);
  }

  const pullRequests = async (oraSpinner, errCodes, repoFullName, page, perPage) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/pulls?state=all&page=${page}&per_page=${perPage}`;
    return await gh.fetchGHJson(ghUrl, oraSpinner, errCodes);
  }

  const repoLanguages = async (oraSpinner, errCodes, repoFullName) => {
    const ghUrl = `https://api.github.com/repos/${repoFullName}/languages`;
    return await gh.fetchGHJson(ghUrl, oraSpinner, errCodes);
  }

  module.exports = {
    repo,
    commits,
    pullRequests,
    repoLanguages,
  };

})();
