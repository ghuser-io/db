#!/usr/bin/env node
'use strict';

(() => {
  const url = require('url');
  const fetchJson = require('./fetchJson');
  const sleep = require('await-sleep');

  const authify = (() => {
    let query = '';
    let auth = '';
    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      console.log('GitHub API key found.');
      query = `client_id=${process.env.GITHUB_CLIENT_ID}&client_secret=${process.env.GITHUB_CLIENT_SECRET}`;
    }
    if (process.env.GITHUB_USERNAME && process.env.GITHUB_PASSWORD) {
      console.log('GitHub credentials found.');
      auth = `${process.env.GITHUB_USERNAME}:${process.env.GITHUB_PASSWORD}`;
    }

    return addr => {
      const result = url.parse(addr);
      result.auth = auth;
      if (query) {
        result.search = result.search && `${result.search}&${query}` || `?${query}`;
      }
      return url.format(result);
    };
  })();

  const fetchGHRateLimit = async oraSpinner => {
    const ghUrl = `https://api.github.com/rate_limit`;
    const ghDataJson = await fetchJson(authify(ghUrl), oraSpinner);
    return ghDataJson.resources;
  };

  const fetchGHJson = async (url, oraSpinner, acceptedErrorCodes=[],
                             /*Date*/ifModifiedSince, graphqlQuery) => {
    const rateLimit = await waitForRateLimit(oraSpinner, !!graphqlQuery);
    try {
      return await fetchJson(authify(url), oraSpinner, acceptedErrorCodes, ifModifiedSince, graphqlQuery);
    } catch (e) {
      console.error(`\nError while fetching ${url}`);
      console.error('API rate limit state:');
      console.error(rateLimit);
      throw e;
    }
  };

  module.exports = {
    fetchGHJson,
    authify,
    fetchGHRateLimit,
  };

  // Waits until we are far away from hitting GitHub's API rate limit.
  // Returns GitHub's rate limit object for reference.
  async function waitForRateLimit(oraSpinner, isGraphQL) {
    const oldSpinnerText = oraSpinner && oraSpinner.text;

    let rateLimit = await fetchGHRateLimit(oraSpinner);
    const lim = rateLimit[isGraphQL ? "graphql" : "core"]
    if (lim.remaining <= 10) {
      const now = (new Date).getTime() / 1000;
      const secondsToSleep = Math.ceil(lim.reset - now) + 1;
      if (secondsToSleep >= 0) {
        if (oraSpinner) {
          oraSpinner.text += ` (waiting ${secondsToSleep} second(s) for API rate limit)`;
        }

        await sleep(secondsToSleep * 1000);
        rateLimit = await fetchGHRateLimit(oraSpinner);
        if (lim.remaining <= 10) {
          console.error('\nAPI rate limit is still low:');
          console.error(rateLimit);
          console.error(`next reset in ${Math.ceil(lim.reset - ((new Date).getTime() / 1000))} seconds(s)`);
          throw 'API rate limit is still low after waiting';
        }

        if (oraSpinner) {
          oraSpinner.text = oldSpinnerText;
        }
      }
    }
    return rateLimit;
  }

})();
