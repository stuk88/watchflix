'use strict';

const { test, expect } = require('./fixtures');

test('filter bar visible on home', async ({ window }) => {
  await window.goto('http://localhost:5173/');
  await window.waitForLoadState('load');
  await expect(window.locator('.filter-bar')).toBeVisible();
});

test('clicking a movie card navigates to /movie/:id', async ({ window }) => {
  await window.goto('http://localhost:5173/');
  await window.waitForLoadState('load');

  const card = window.locator('.movie-card').first();
  if ((await card.count()) === 0) {
    test.skip();
    return;
  }

  await card.click();
  await window.waitForLoadState('load');
  expect(window.url()).toMatch(/\/movie\/.+/);
});

test('back button returns to home', async ({ window }) => {
  await window.goto('http://localhost:5173/');
  await window.waitForLoadState('load');

  const card = window.locator('.movie-card').first();
  if ((await card.count()) === 0) {
    test.skip();
    return;
  }

  await card.click();
  await window.waitForLoadState('load');
  await window.goBack();
  await window.waitForLoadState('load');
  expect(window.url()).toMatch(/localhost:5173\/?$/);
});
