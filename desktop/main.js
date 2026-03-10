'use strict';

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const isDev = !app.isPackaged;

let mainWindow = null;
let apiProcess = null;

// Poll until the HTTP server at `url` responds, or we time out.
function waitForServer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      http
        .get(url, () => resolve())
        .on('error', () => {
          if (Date.now() >= deadline) {
            reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`));
          } else {
            setTimeout(check, 500);
          }
        });
    };
    check();
  });
}

function startApi() {
  let nodeBin, apiEntry, apiCwd;

  if (isDev) {
    // In dev, use the system `node` binary and the source tree directly.
    nodeBin = 'node';
    apiEntry = path.join(__dirname, '..', 'api', 'src', 'index.js');
    apiCwd = path.join(__dirname, '..', 'api');
  } else {
    // In production, reuse Electron's own Node.js runtime via ELECTRON_RUN_AS_NODE.
    nodeBin = process.execPath;
    apiEntry = path.join(process.resourcesPath, 'api', 'src', 'index.js');
    apiCwd = path.join(process.resourcesPath, 'api');
  }

  const env = {
    ...process.env,
    PORT: '3001',
    // Tell the API where the built UI assets are so it can serve them as static files.
    ...(isDev ? {} : { UI_DIST: path.join(process.resourcesPath, 'ui-dist') }),
    // Makes the Electron binary behave like `node` in production.
    ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
  };

  apiProcess = spawn(nodeBin, [apiEntry], { env, cwd: apiCwd, stdio: 'pipe' });
  apiProcess.stdout.on('data', d => process.stdout.write(`[api] ${d}`));
  apiProcess.stderr.on('data', d => process.stderr.write(`[api] ${d}`));
  apiProcess.on('exit', code => console.log(`[api] exited with code ${code}`));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    // Vite dev server — started by `desktop:dev` via concurrently
    await waitForServer('http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // API serves the built UI from process.env.UI_DIST in production
    await waitForServer('http://localhost:3001/api/health');
    mainWindow.loadURL('http://localhost:3001');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startApi();
  await createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

// Kill the API child process cleanly before the app exits.
app.on('before-quit', () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
  }
});
