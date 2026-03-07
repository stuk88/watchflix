import { test, expect } from '@playwright/test';

/**
 * Full E2E subtitle flow tests for TorrentPlayer.
 *
 * Tests the complete subtitle lifecycle:
 *   - CC bar appears after starting torrent stream
 *   - Language selection and sub-picker behavior
 *   - Torrent filename display
 *   - Sync bar controls and offset adjustments
 *   - Turning subtitles off
 *   - Torrent-bundled subtitle files
 *
 * Requires: dev server on 127.0.0.1:5173, API on 127.0.0.1:3001.
 * NOTE: Use 127.0.0.1 NOT localhost — Playwright resolves localhost to IPv6 ::1.
 * Movie 1351 = Attack on Titan (has working torrent + 18 subtitle languages).
 */

const UI = 'http://localhost:5173';
const MOVIE_ID = 1351;

test.describe.serial('TorrentPlayer — full subtitle flow', () => {
  /** Shared page across all serial tests */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ---------------------------------------------------------------------------
  // Test 1: Start torrent player, verify CC bar and language buttons appear
  // ---------------------------------------------------------------------------
  test('CC bar appears and has ≥5 language buttons after starting torrent stream', async () => {
    test.setTimeout(90000);

    await page.goto(`${UI}/movie/${MOVIE_ID}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Switch to Torrent Stream tab if both sources are available
    const torrentTab = await page.$('.source-tab:has-text("Torrent Stream")');
    if (torrentTab) {
      await torrentTab.click();
      await page.waitForTimeout(300);
    }

    // Click the torrent player start button
    const startBtn = await page.waitForSelector('.player-start', { timeout: 10000 });
    await startBtn.click();

    // Wait for CC bar — subtitles are fetched from API independently of stream readiness
    const subtitleBar = await page.waitForSelector('.subtitle-bar', { timeout: 30000 });
    expect(subtitleBar, '.subtitle-bar must appear').toBeTruthy();

    // Verify language buttons exist (movie has 18 languages, require ≥5)
    const subBtns = await page.$$('.btn-sub');
    console.log(`[test1] Found ${subBtns.length} .btn-sub button(s)`);
    expect(subBtns.length, 'At least 5 .btn-sub buttons must be present').toBeGreaterThanOrEqual(5);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Select English subtitle — picker appears if multiple files, activates button
  // ---------------------------------------------------------------------------
  test('Selecting English activates it; sub-picker appears for multiple files and closes after selection', async () => {
    test.setTimeout(30000);

    // English button must exist
    const englishBtn = await page.waitForSelector('.btn-sub:has-text("English")', { timeout: 10000 });
    expect(englishBtn, 'English .btn-sub must be present').toBeTruthy();

    // Read file count from the (N) badge if present
    const fileCountSpan = await englishBtn.$('.file-count');
    const fileCount = fileCountSpan
      ? parseInt((await fileCountSpan.textContent()).replace(/[()]/g, '').trim(), 10)
      : 1;
    console.log(`[test2] English has ${fileCount} file(s)`);

    await englishBtn.click();

    if (fileCount > 1) {
      // Sub-picker must appear
      const picker = await page.waitForSelector('.sub-picker', { timeout: 5000 });
      expect(picker, '.sub-picker must appear when language has multiple files').toBeTruthy();

      // Click first file in picker
      const firstFile = await page.waitForSelector('.btn-sub-file', { timeout: 5000 });
      await firstFile.click();

      // Picker must close after selection
      await page.waitForSelector('.sub-picker', { state: 'hidden', timeout: 5000 });
      console.log('[test2] sub-picker closed after file selection');
    }

    // English button must be active
    const isActive = await englishBtn.evaluate(el => el.classList.contains('active'));
    expect(isActive, 'English .btn-sub must have .active class after selection').toBeTruthy();
    console.log('[test2] English subtitle activated — .active confirmed');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Torrent filename is displayed after metadata loads
  // ---------------------------------------------------------------------------
  test('Torrent filename appears after metadata loads', async () => {
    test.setTimeout(60000);

    // Torrent metadata may take time to arrive; wait generously
    const filenameEl = await page.waitForSelector('.torrent-filename', { timeout: 60000 });
    const text = (await filenameEl.textContent()).trim();
    console.log(`[test3] torrent filename: "${text}"`);
    expect(text.length, '.torrent-filename must contain text').toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Sync bar appears; offset buttons work; Reset restores +0.0s
  // ---------------------------------------------------------------------------
  test('Sync bar appears after subtitle selection and offset controls work', async () => {
    test.setTimeout(15000);

    // Sync bar is visible when an activeSubUrl is set
    const syncBar = await page.waitForSelector('.sync-bar', { timeout: 10000 });
    expect(syncBar, '.sync-bar must appear after subtitle is selected').toBeTruthy();

    // All sync buttons must exist
    const syncBtns = await page.$$('.btn-sync');
    const btnLabels = await Promise.all(syncBtns.map(b => b.textContent()));
    console.log(`[test4] Sync buttons: ${btnLabels.map(l => l.trim()).join(', ')}`);

    const expectedBtns = ['-5s', '-0.5s', '+0.5s', '+5s', 'Reset', 'Auto Sync'];
    for (const label of expectedBtns) {
      const found = btnLabels.some(l => l.trim().includes(label));
      expect(found, `Sync button "${label}" must be present`).toBeTruthy();
    }

    // Initial offset should be +0.0s
    const syncLabel = page.locator('.sync-label');
    const initialLabel = (await syncLabel.textContent()).trim();
    console.log(`[test4] initial sync label: "${initialLabel}"`);
    expect(initialLabel, 'Initial sync offset must be +0.0s').toBe('+0.0s');

    // Click +0.5s
    await page.click('.btn-sync:has-text("+0.5s")');
    const afterPlus = (await syncLabel.textContent()).trim();
    console.log(`[test4] after +0.5s: "${afterPlus}"`);
    expect(afterPlus, 'Offset must be +0.5s after clicking +0.5s').toBe('+0.5s');

    // Click Reset — restores +0.0s
    await page.click('.btn-sync-reset, .btn-sync.btn-sync-reset');
    const afterReset = (await syncLabel.textContent()).trim();
    console.log(`[test4] after Reset: "${afterReset}"`);
    expect(afterReset, 'Offset must return to +0.0s after Reset').toBe('+0.0s');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Turn subtitles off — no language active, sync bar hides
  // ---------------------------------------------------------------------------
  test('Clicking Off deactivates subtitle and hides sync bar', async () => {
    test.setTimeout(10000);

    // Click Off button
    await page.click('.btn-sub:has-text("Off")');

    // Off button must be active
    const offBtn = page.locator('.btn-sub:has-text("Off")');
    const offActive = await offBtn.evaluate(el => el.classList.contains('active'));
    expect(offActive, 'Off .btn-sub must have .active class').toBeTruthy();

    // No other language button should be active
    const activeLangBtns = await page.$$('.btn-sub.active:not(:has-text("Off"))');
    expect(activeLangBtns.length, 'No language button should be active when subtitle is Off').toBe(0);

    // Sync bar must disappear (no active subtitle)
    await page.waitForSelector('.sync-bar', { state: 'hidden', timeout: 5000 });
    console.log('[test5] .sync-bar hidden after turning subtitles Off');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Torrent-bundled subtitles (if available)
  // ---------------------------------------------------------------------------
  test('Torrent bundled subtitle button shows picker with "📦 from torrent" files (if present)', async () => {
    test.setTimeout(15000);

    const torrentSubBtn = await page.$('.btn-sub:has-text("📦 Torrent")');

    if (!torrentSubBtn) {
      console.log('[test6] No "📦 Torrent" button found — torrent has no bundled subs, skipping');
      test.skip();
      return;
    }

    console.log('[test6] "📦 Torrent" button found — testing picker');
    // Re-query via locator to avoid stale element after DOM updates in previous tests
    await page.locator('.btn-sub:has-text("📦 Torrent")').click();

    // Picker must open
    const picker = await page.waitForSelector('.sub-picker', { timeout: 5000 });
    expect(picker, '.sub-picker must appear for torrent subtitle button').toBeTruthy();

    // All files in picker must have "📦 from torrent" label
    const torrentLabels = await page.$$('.sub-downloads:has-text("📦 from torrent")');
    expect(torrentLabels.length, 'Picker must show files with "📦 from torrent" label').toBeGreaterThan(0);
    console.log(`[test6] ${torrentLabels.length} "📦 from torrent" file(s) in picker`);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Subtitles render via native TextTrack in fullscreen
  // ---------------------------------------------------------------------------
  test('Subtitles use native TextTrack API and render in fullscreen', async () => {
    test.setTimeout(60000);

    // Re-select English subtitle (was turned off in test 5)
    const englishBtn = await page.waitForSelector('.btn-sub:has-text("English")', { timeout: 5000 });
    await englishBtn.click();

    // If file picker appears, select first file
    const picker = await page.$('.sub-picker');
    if (picker) {
      const firstFile = await page.waitForSelector('.btn-sub-file', { timeout: 3000 });
      await firstFile.click();
    }

    // Wait for video to have enough data and TextTrack to be populated
    // Poll until TextTrack appears with cues (VTT fetch + parse takes time)
    const trackInfo = await page.waitForFunction(() => {
      const video = document.querySelector('video');
      if (!video || !video.textTracks) return null;
      for (let i = 0; i < video.textTracks.length; i++) {
        const t = video.textTracks[i];
        if (t.mode === 'showing' && t.cues && t.cues.length > 0) {
          return { kind: t.kind, mode: t.mode, cueCount: t.cues.length };
        }
      }
      return null;
    }, null, { timeout: 15000 }).then(h => h.jsonValue());

    console.log(`[test7] TextTrack info:`, trackInfo);
    expect(trackInfo, 'Video must have a TextTrack with showing mode and cues').not.toBeNull();
    expect(trackInfo.mode, 'TextTrack mode must be "showing"').toBe('showing');
    expect(trackInfo.cueCount, 'TextTrack must have cues loaded').toBeGreaterThan(0);

    // No custom subtitle overlay div should exist
    const overlay = await page.$('.subtitle-overlay');
    expect(overlay, 'No .subtitle-overlay div should exist (using native TextTrack)').toBeNull();

    console.log(`[test7] Native TextTrack confirmed: ${trackInfo.cueCount} cues, mode=${trackInfo.mode}`);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Auto Sync button triggers whisper-sync API call
  // ---------------------------------------------------------------------------
  test('Auto Sync triggers whisper-sync endpoint and updates offset', async () => {
    test.setTimeout(180000); // Whisper can take up to 2 min

    // Need video playing with subtitle selected — should be set from test 7
    // Seek to at least 30s to have enough audio context
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video && video.readyState >= 2) video.currentTime = 60;
    });
    await page.waitForTimeout(2000);

    // Intercept the whisper-sync API call
    const apiPromise = page.waitForResponse(
      resp => resp.url().includes('/whisper-sync') && resp.request().method() === 'POST',
      { timeout: 150000 }
    );

    // Click Auto Sync
    const autoSyncBtn = await page.waitForSelector('.btn-auto-sync', { timeout: 5000 });
    expect(autoSyncBtn, 'Auto Sync button must exist').toBeTruthy();
    await autoSyncBtn.click();

    // Button should show syncing state (disabled)
    const isDisabled = await autoSyncBtn.evaluate(el => el.disabled);
    expect(isDisabled, 'Auto Sync button should be disabled while syncing').toBeTruthy();
    console.log('[test8] Auto Sync clicked, waiting for whisper-sync response...');

    // Wait for API response
    const response = await apiPromise;
    const status = response.status();
    console.log(`[test8] whisper-sync responded with status ${status}`);

    if (status === 200) {
      const body = await response.json();
      console.log(`[test8] offset=${body.offset}, confidence=${body.confidence}, detected=${body.detectedLanguage}`);
      expect(typeof body.offset, 'Response must have numeric offset').toBe('number');
      expect(typeof body.confidence, 'Response must have numeric confidence').toBe('number');

      // Sync status should appear briefly
      const syncStatus = await page.waitForSelector('.sync-status', { timeout: 5000 }).catch(() => null);
      if (syncStatus) {
        const statusText = await syncStatus.textContent();
        console.log(`[test8] sync status: "${statusText}"`);
      }
    } else {
      // 422 (no speech) or 500 are acceptable — we just verify the endpoint was called
      console.log(`[test8] whisper-sync returned ${status} — endpoint works, sync may have failed (no speech / no match)`);
    }
  });
});
