#!/usr/bin/env node
'use strict';

//TODO all this should move inside db.js and this file should be removed.

(() => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.GHUSER_DBDIR || path.join(os.homedir(), 'data');

  if (!fs.existsSync(dbPath)) {
    throw `${dbPath} directory doesn't exist`;
  }

  module.exports = {
    root: dbPath
  };
  module.exports.users = path.join(module.exports.root, 'users');
  module.exports.contribs = path.join(module.exports.root, 'contribs');
  module.exports.repos = path.join(module.exports.root, 'repos');
  module.exports.repoCommits = path.join(module.exports.root, 'repoCommits');
  module.exports.orgs = path.join(module.exports.root, 'orgs');

  module.exports.nonOrgs = path.join(module.exports.root, 'nonOrgs.json');
  module.exports.meta = path.join(module.exports.root, 'meta.json');

})();
