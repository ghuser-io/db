#!/usr/bin/env node
'use strict';

(() => {

  const os = require('os');
  const path = require('path');

  module.exports = {
    root: path.join(os.homedir(), 'data')
  };
  module.exports.users = path.join(module.exports.root, 'users');
  module.exports.contribs = path.join(module.exports.root, 'contribs');
  module.exports.repos = path.join(module.exports.root, 'repos');
  module.exports.repoCommits = path.join(module.exports.root, 'repoCommits');
  module.exports.orgs = path.join(module.exports.root, 'orgs.json');
  module.exports.nonOrgs = path.join(module.exports.root, 'nonOrgs.json');
  module.exports.meta = path.join(module.exports.root, 'meta.json');

})();
