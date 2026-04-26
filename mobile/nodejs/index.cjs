const { channel } = require('bridge');

process.env.CAPACITOR_NODEJS = '1';

async function startApi() {
  try {
    const express = (await import('./api-bundle/src/index.js')).default || (await import('express')).default;
    // The API index.js calls app.listen() itself — just wait for it
    channel.send('api-ready', JSON.stringify({ port: 3001 }));
    console.log('[mobile-api] API started');
  } catch (err) {
    channel.send('api-error', err.message);
    console.error('[mobile-api] Failed:', err.message, err.stack);
  }
}

channel.addListener('start-api', () => startApi());
channel.send('nodejs-ready', '');
