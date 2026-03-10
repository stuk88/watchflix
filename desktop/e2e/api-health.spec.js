'use strict';

const { test, expect } = require('./fixtures');

test('api health endpoint returns 200', async ({ window }) => {
  const status = await window.evaluate(async () => {
    const res = await fetch('http://localhost:3001/api/health');
    return res.status;
  });
  expect(status).toBe(200);
});

test('api movies endpoint returns JSON with movies array', async ({ window }) => {
  const result = await window.evaluate(async () => {
    const res = await fetch('http://localhost:3001/api/movies');
    return res.json();
  });
  expect(Array.isArray(result.movies)).toBe(true);
});
