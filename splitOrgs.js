#!/usr/bin/env node
'use strict';

(() => {

  const path = require('path');

  const data = require('./impl/data');
  const DbFile = require('./impl/dbFile');
  const scriptUtils = require('./impl/scriptUtils');

  scriptUtils.printUnhandledRejections();

  splitOrgs();
  return;

  function splitOrgs() {
    const oldOrgs = new DbFile(path.join(data.root, 'orgs.json'));
    for (const oldOrg in oldOrgs.orgs) {
      const newOrg = new DbFile(path.join(data.orgs, `${oldOrg}.json`));
      Object.assign(newOrg, oldOrgs.orgs[oldOrg]);
      newOrg.write();
    }
  }

})();
