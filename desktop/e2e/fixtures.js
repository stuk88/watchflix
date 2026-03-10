'use strict';

const { test: base, _electron } = require('@playwright/test');
const path = require('path');

exports.test = base.extend({
  electronApp: [
    async ({}, use) => {
      const app = await _electron.launch({
        args: [path.join(__dirname, '..', 'main.js')],
      });
      await use(app);
      await app.close();
    },
    { scope: 'worker' },
  ],

  window: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow();
    await win.waitForLoadState('load');
    await use(win);
  },
});

exports.expect = base.expect;
