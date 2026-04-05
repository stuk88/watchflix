'use strict';

const { app, BrowserWindow, session } = require('electron');
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
  // In dev, icon is at desktop/build/icon.png. In production, electron-builder
  // converts it to icon.icns in Resources/. On macOS the .icns is used automatically;
  // on other platforms, pass the PNG path to BrowserWindow.
  const iconPath = isDev
    ? path.join(__dirname, 'build', 'icon.png')
    : path.join(process.resourcesPath, 'icon.icns');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[main] ready-to-show fired — showing window');
    mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error(`[main] did-fail-load: ${code} ${desc}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load');
  });

  if (isDev) {
    // Vite dev server — started by `desktop:dev` via concurrently
    await waitForServer('http://localhost:5173');
    console.log('[main] Loading Vite dev server...');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // API serves the built UI from process.env.UI_DIST in production
    await waitForServer('http://localhost:3001/api/health');
    console.log('[main] API ready, loading UI...');
    mainWindow.loadURL('http://localhost:3001');
  }

  // Block popups (ad windows) from any iframe.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // When a 123movies frame finishes loading, inject CSS to hide site chrome
  // and make the player area fill the iframe.
  mainWindow.webContents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (isMainFrame) return;
    try {
      for (const frame of mainWindow.webContents.mainFrame.framesInSubtree) {
        if (frame.url.includes('123movie')) {
          frame.executeJavaScript(`
            (function() {
              if (document.getElementById('__wf_injected')) return;
              const s = document.createElement('style');
              s.id = '__wf_injected';
              s.textContent = \`
                header, .nav, ol.breadcrumb,
                .watch-extra, section.bl, .bl-2,
                footer, .footer { display: none !important; }

                body { margin: 0 !important; padding: 0 !important; overflow-x: hidden !important; }

                .container { max-width: 100% !important; width: 100% !important; padding: 0 !important; }

                #player, .iframecontainer { width: 100% !important; max-width: 100% !important; min-height: 400px !important; height: 60vh !important; }
                #player iframe, #videoiframe { width: 100% !important; height: 100% !important; min-height: 400px !important; }

                .play { width: 100% !important; max-width: 100% !important;
                         background-size: cover !important; }

                /* Hide poster once the video player iframe loads inside #player */
                .play:has(#player iframe) {
                  background-image: none !important;
                  background: #000 !important;
                }
              \`;
              document.head.appendChild(s);

              /* kill popup helpers */
              window.open = () => null;
              /* absorb ad click interceptors on the body/document */
              document.addEventListener('click', function(e) {
                const t = e.target;
                if (t.tagName === 'A' && t.target === '_blank') { e.preventDefault(); e.stopPropagation(); }
              }, true);

              /* Fallback for poster hide: observe #player for iframe insertion */
              const playerEl = document.getElementById('player');
              const playEl = document.querySelector('.play');
              if (playerEl && playEl) {
                new MutationObserver(() => {
                  if (playerEl.querySelector('iframe')) {
                    playEl.style.backgroundImage = 'none';
                    playEl.style.background = '#000';
                  }
                }).observe(playerEl, { childList: true, subtree: true });
              }
            })();
          `).catch(() => {});
        }
      }
    } catch (_) {}
  });

  // Recover from renderer crashes (e.g. V8 crashes from embed content).
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[main] Renderer process gone: ${details.reason} (exit code ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      console.log('[main] Reloading after renderer crash...');
      mainWindow.webContents.reload();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Strip X-Frame-Options and CSP headers for ALL sub-frame (iframe) responses so
  // embed chains (123movies → netoda.tech → vsembed.ru → cloudnestra.com → …)
  // load regardless of which domains the providers rotate to.
  //
  // Only sub-frame responses are touched — scripts, media chunks, XHR, images,
  // etc. pass through unmodified.  The original approach of processing every
  // response caused a V8 BackingStore crash under load from video stream chunks.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'subFrame') {
      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'x-frame-options' || lower === 'content-security-policy') {
          delete headers[key];
        }
      }
      callback({ responseHeaders: headers });
      return;
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  if (!isDev) startApi();
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
