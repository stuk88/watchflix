import { channel } from 'bridge';

process.env.CAPACITOR_NODEJS = '1';

let apiPort = null;

async function startApi() {
  try {
    const { default: app } = await import('../api-bundle/src/index.js');
    apiPort = app?.address?.()?.port || 3001;
    channel.send('api-ready', JSON.stringify({ port: apiPort }));
    console.log(`[mobile-api] Express API started on port ${apiPort}`);
  } catch (err) {
    channel.send('api-error', err.message);
    console.error('[mobile-api] Failed to start:', err.message);
  }
}

channel.addListener('start-api', () => {
  startApi();
});

channel.send('nodejs-ready', '');
