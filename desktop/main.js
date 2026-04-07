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
      webSecurity: false,
      webviewTag: true,
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
        const url = frame.url;

        // --- 123movies ---
        if (url.includes('123movie')) {
          frame.executeJavaScript(`
            (function() {
              if (document.getElementById('__wf_injected')) return;
              const s = document.createElement('style');
              s.id = '__wf_injected';
              s.textContent = \`
                header, .nav, ol.breadcrumb,
                .watch-extra, section.bl, .bl-2,
                footer, .footer, #episodes { display: none !important; }

                html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: 100vh !important; }

                #body { margin: 0 !important; padding: 0 !important; height: 100vh !important; }

                #watch { margin: 0 !important; padding: 0 !important; height: 100vh !important; }

                .container { max-width: 100% !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }

                .play { width: 100% !important; max-width: 100% !important; height: 100vh !important;
                         margin: 0 !important; padding: 0 !important; background-size: cover !important; }

                #player, .iframecontainer { width: 100% !important; max-width: 100% !important; height: 100vh !important; }
                #player iframe, #videoiframe { width: 100% !important; height: 100vh !important; }

                .play:has(#player iframe) {
                  background-image: none !important;
                  background: #000 !important;
                }
              \`;
              document.head.appendChild(s);
              window.open = () => null;
              document.addEventListener('click', function(e) {
                const t = e.target;
                if (t.tagName === 'A' && t.target === '_blank') { e.preventDefault(); e.stopPropagation(); }
              }, true);
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

        // --- Hdrezka ---
        if (url.includes('hdrezka') || url.includes('rezka')) {
          frame.executeJavaScript(`
            (function() {
              if (document.getElementById('__wf_injected')) return;
              const s = document.createElement('style');
              s.id = '__wf_injected';
              s.textContent = \`
                /* Hide everything except player + episode selectors */
                .b-wrapper__sidebar, .b-post__rating_and, .b-post__infotable_right_inner,
                .b-post__description, .b-post__social, .b-post__mixtures,
                .b-post__actions, .b-post__rating, .comments-tree-list,
                .b-content__htitle, .b-content__main > .b-post__lastepisodeout ~ *:not(.b-content__main),
                header, footer, .b-header, .b-footer,
                .b-post__schedule, .b-post__franchise_list_item,
                .b-sidetop, .b-sidelist, .b-ads, .b-post__support,
                .b-post__info > table, .b-content__bubble_rating,
                ol.breadcrumb { display: none !important; }

                html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }

                .b-content__main { padding: 0 !important; margin: 0 auto !important; max-width: 100% !important; }

                /* Player full width */
                #cdnplayer, .b-player, #cdnplayer-container,
                .b-player__iframe_container, .b-player iframe {
                  width: 100% !important; max-width: 100% !important; min-height: 70vh !important;
                }

                /* Season/episode selectors - keep visible, style clean */
                .b-simple_season__list, .b-simple_episodes__list,
                .b-translators__list {
                  display: flex !important; flex-wrap: wrap !important;
                  gap: 4px !important; padding: 8px !important;
                  background: #111 !important;
                }
                .b-simple_season__list li, .b-simple_episodes__list li,
                .b-translators__list li {
                  padding: 4px 10px !important; border-radius: 4px !important;
                  background: #222 !important; color: #ccc !important;
                  cursor: pointer !important; font-size: 13px !important;
                }
                .b-simple_season__list li.active, .b-simple_episodes__list li.active,
                .b-translators__list li.active {
                  background: #4a6cf7 !important; color: #fff !important;
                }

                .b-wrapper { max-width: 100% !important; padding: 0 !important; }
                .b-container { max-width: 100% !important; padding: 0 !important; }
              \`;
              document.head.appendChild(s);
              window.open = () => null;
              document.addEventListener('click', function(e) {
                const t = e.target;
                if (t.tagName === 'A' && t.target === '_blank') { e.preventDefault(); e.stopPropagation(); }
              }, true);
            })();
          `).catch(() => {});
        }

        // --- Filmix ---
        if (url.includes('filmix')) {
          frame.executeJavaScript(`
            (function() {
              if (document.getElementById('__wf_injected')) return;
              const s = document.createElement('style');
              s.id = '__wf_injected';
              s.textContent = \`
                /* Hide everything except player + translation/episode selectors */
                .header-f, header, footer, nav, .sidebar, .comments,
                .related, .full-story-line, .full-story__info,
                .full-story__text, .full-story__rate, .full-story__share,
                .full-story-header, .full-story-title,
                .breadcrumbs, .user-favs, .info-panel,
                .slider-block, .category-film, .footer-f,
                .full-story__poster, .full-story-desc,
                .full-story-tables, .full-story-links,
                .full-story-franchise, .full-story-additional { display: none !important; }

                html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }

                .content, #dle-content, .full-story, .fullstory {
                  padding: 0 !important; margin: 0 !important; max-width: 100% !important;
                }

                /* Player full width */
                #player, .player, .player iframe, .player video {
                  width: 100% !important; max-width: 100% !important; min-height: 70vh !important;
                  margin: 0 !important;
                }

                /* Translation selector - keep visible */
                .translations {
                  display: flex !important; flex-wrap: wrap !important;
                  gap: 4px !important; padding: 8px !important;
                  background: #111 !important;
                }
                .translations li, .translations a, .translations .item {
                  padding: 4px 10px !important; border-radius: 4px !important;
                  background: #222 !important; color: #ccc !important;
                  cursor: pointer !important; font-size: 13px !important;
                }
                .translations .active, .translations .current {
                  background: #4a6cf7 !important; color: #fff !important;
                }
              \`;
              document.head.appendChild(s);
              window.open = () => null;
              document.addEventListener('click', function(e) {
                const t = e.target;
                if (t.tagName === 'A' && t.target === '_blank') { e.preventDefault(); e.stopPropagation(); }
              }, true);
            })();
          `).catch(() => {});
        }

        // --- Seazonvar ---
        if (url.includes('seasonvar') || url.includes('sezonvar')) {
          frame.executeJavaScript(`
            (function() {
              if (document.getElementById('__wf_injected')) return;
              const s = document.createElement('style');
              s.id = '__wf_injected';
              s.textContent = \`
                header, footer, nav, .sidebar, .comments,
                .related, .breadcrumbs, .info-panel,
                .site-header, .site-footer { display: none !important; }

                html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }

                #player, .player, .player iframe, .player video {
                  width: 100% !important; max-width: 100% !important; min-height: 70vh !important;
                }

                .seasons-list, .episodes-list {
                  display: flex !important; flex-wrap: wrap !important;
                  gap: 4px !important; padding: 8px !important;
                  background: #111 !important;
                }
              \`;
              document.head.appendChild(s);
              window.open = () => null;
            })();
          `).catch(() => {});
        }
      }
    } catch (_) {}
  });

  // Clear session cache when navigating away from a movie page (SPA route change).
  // This deletes cached 123movies iframe content (HTML, JS, video segments) from disk.
  let wasOnMoviePage = false;
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    const isMoviePage = url.includes('/movie/');
    if (wasOnMoviePage && !isMoviePage) {
      console.log('[main] Left movie page — clearing session cache');
      session.defaultSession.clearCache().catch(() => {});
      session.defaultSession.clearStorageData({
        storages: ['cachestorage', 'serviceworkers'],
      }).catch(() => {});
    }
    wasOnMoviePage = isMoviePage;
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
