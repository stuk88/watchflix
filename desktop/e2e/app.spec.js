'use strict';

const { test, expect } = require('./fixtures');

test('window opens with Watchflix title', async ({ window }) => {
  const title = await window.title();
  expect(title).toContain('Watchflix');
});

test('home page shows movie grid or empty state', async ({ window }) => {
  const grid = window.locator('.movie-grid');
  const empty = window.locator('.empty-state');
  const hasGrid = await grid.count() > 0;
  const hasEmpty = await empty.count() > 0;
  expect(hasGrid || hasEmpty).toBe(true);
});

test('navigates to /favorites', async ({ window }) => {
  await window.goto('http://localhost:5173/favorites');
  await window.waitForLoadState('load');
  expect(window.url()).toContain('/favorites');
});

test('navigates to /hidden', async ({ window }) => {
  await window.goto('http://localhost:5173/hidden');
  await window.waitForLoadState('load');
  expect(window.url()).toContain('/hidden');
});
