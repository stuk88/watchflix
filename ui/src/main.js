import { createApp } from 'vue';
import { createPinia } from 'pinia';
import axios from 'axios';
import App from './App.vue';
import router from './router.js';
import './styles/main.css';

if (import.meta.env.VITE_API_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_URL;
}

async function initMobileApi() {
  try {
    const { NodeJS } = await import('capacitor-nodejs');
    await NodeJS.whenReady();
    return new Promise((resolve) => {
      NodeJS.addListener('api-ready', (event) => {
        const { port } = JSON.parse(event.args);
        axios.defaults.baseURL = `http://127.0.0.1:${port}`;
        console.log(`[mobile] API ready on port ${port}`);
        resolve();
      });
      NodeJS.addListener('api-error', (event) => {
        console.error('[mobile] API failed:', event.args);
        resolve();
      });
      NodeJS.send({ eventName: 'start-api', args: [] });
      setTimeout(resolve, 10000);
    });
  } catch {
    // Not on mobile / plugin not available
  }
}

initMobileApi().then(() => {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');
});
