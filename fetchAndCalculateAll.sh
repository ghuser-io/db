#!/usr/bin/env bash

set -e

function run {
  ./fetchUserDetailsAndContribs.js
  ./fetchOrgs.js
  ./fetchRepos.js
  ./calculateContribsAndMeta.js
  ./printDataStats.js
}

time run
