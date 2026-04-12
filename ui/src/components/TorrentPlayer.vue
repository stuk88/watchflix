<template>
  <div class="torrent-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">▶</div>
      <div class="start-text">Start Streaming</div>
      <div class="start-quality" v-if="quality">{{ quality }}</div>
    </div>
    <div v-else>
      <!-- Loading / buffering indicator -->
      <div v-if="status === 'loading'" class="loading-overlay">
        <div class="loading-spinner"></div>
        <div class="loading-text">Connecting to peers...</div>
      </div>
      <div v-if="status === 'playing' && progress < 5" class="buffering-bar">
        <div class="buffer-fill" :style="{ width: progress + '%' }"></div>
        <span class="buffer-text">Buffering {{ progress }}%</span>
      </div>

      <div class="video-wrap">
        <video
          ref="videoEl"
          class="video-js vjs-big-play-centered vjs-fluid"
        ></video>
      </div>

      <!-- Download progress bar -->
      <div class="download-bar">
        <div class="download-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <!-- Subtitle sync controls (shown when a track is active) -->
      <div v-if="activeSubUrl" class="sync-bar">
        <button class="btn btn-sync btn-auto-sync" @click="autoSync" :disabled="syncing">
          {{ syncing ? '⏳ Syncing...' : '🔄 Auto Sync' }}
        </button>
        <button class="btn btn-sync" @click="adjustOffset(-5)">-5s</button>
        <button class="btn btn-sync" @click="adjustOffset(-0.5)">-0.5s</button>
        <span class="sync-label">{{ subOffset >= 0 ? '+' : '' }}{{ subOffset.toFixed(1) }}s</span>
        <button class="btn btn-sync" @click="adjustOffset(0.5)">+0.5s</button>
        <button class="btn btn-sync" @click="adjustOffset(5)">+5s</button>
        <button class="btn btn-sync btn-sync-reset" @click="adjustOffset(-subOffset)">Reset</button>
        <span v-if="syncStatus" class="sync-status">{{ syncStatus }}</span>
      </div>
      <!-- Torrent filename -->
      <div v-if="torrentFilename" class="torrent-filename">📁 {{ torrentFilename }}</div>
      <div class="torrent-info">
        <span>⬇ {{ downloadSpeed }}</span>
        <span>⬆ {{ uploadSpeed }}</span>
        <span>👥 {{ peerCount }} peers</span>
        <span>📊 {{ progress }}%</span>
      </div>

      <!-- Loading state -->
      <div v-if="status === 'loading'" class="fallback-msg">
        Connecting to peers and loading metadata...
      </div>

      <!-- Zero-peer fallback UI -->
      <div v-if="status === 'searching'" class="fallback-msg">
        No peers found. Searching for alternatives...
      </div>
      <div v-else-if="status === 'dead'" class="fallback-dead">
        <p>No sources available for this movie.</p>
        <button class="btn btn-danger" @click="removeMovie">🗑 Remove Movie</button>
      </div>
      <div v-else-if="status === 'found'" class="fallback-alts">
        <p>No peers on current source. Try an alternative:</p>
        <div class="alt-list">
          <button
            v-for="(alt, i) in altSources"
            :key="i"
            class="btn btn-alt"
            @click="switchToAlt(alt)"
          >
            {{ alt.source.toUpperCase() }} · {{ alt.quality }} · {{ alt.seeds }} seeds
            <span v-if="alt.size" class="alt-size">{{ alt.size }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

const props = defineProps({
  magnet: String,
  quality: String,
  movieId: [String, Number],
});

const router = useRouter();
const started = ref(false);
const videoEl = ref(null);
let vjsPlayer = null;
const downloadSpeed = ref('0 KB/s');
const uploadSpeed = ref('0 KB/s');
const peerCount = ref(0);
const progress = ref(0);

// 'idle' | 'loading' | 'playing' | 'searching' | 'found' | 'dead'
const status = ref('idle');
const altSources = ref([]);

// Current stream movie ID (can change when switching to alt)
const activeMovieId = ref(null);
const activeStreamUrl = ref('');
let statsInterval = null;
let peerCheckTimer = null;
let subtitlesFetched = false;
let torrentSubsAdded = false;

const streamUrl = computed(() => activeStreamUrl.value);

const subtitleTracks = ref([]);
const activeSubUrl = ref(null);
const torrentFilename = ref('');
const subOffset = ref(0);
const syncing = ref(false);
const syncStatus = ref('');

function formatSpeed(bytes) {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

async function pollStats() {
  if (!activeMovieId.value) return;
  try {
    const { data } = await axios.get(`/api/movies/${activeMovieId.value}/stream-stats`);
    if (data) {
      peerCount.value = data.peers || 0;
      downloadSpeed.value = formatSpeed(data.downloadSpeed || 0);
      uploadSpeed.value = formatSpeed(data.uploadSpeed || 0);
      progress.value = data.total ? ((data.downloaded / data.total) * 100).toFixed(1) : 0;

      // Once we have peers, we're playing
      if (data.peers > 0 && status.value === 'loading') {
        status.value = 'playing';
      }

      // Fetch subtitles by filename once available
      if (data.filename && !subtitlesFetched) {
        subtitlesFetched = true;
        torrentFilename.value = data.filename;
        fetchSubtitlesForMovie(data.filename);
      }

      // Add torrent-bundled subtitle files
      if (data.subtitleFiles?.length && !torrentSubsAdded) {
        torrentSubsAdded = true;
        addTorrentSubtitleFiles(data.subtitleFiles);
      }
    }
  } catch {}
}

async function fetchSubtitlesForMovie(filename) {
  try {
    const params = filename ? `?filename=${encodeURIComponent(filename)}` : '';
    const { data } = await axios.get(`/api/movies/${props.movieId}/subtitles${params}`);
    subtitleTracks.value = data.tracks || [];
    addAllTracksToPlayer();
  } catch (err) {
    console.error('[torrent-player] Subtitle fetch error:', err.message);
  }
}

function addTorrentSubtitleFiles(subFiles) {
  const torrentGroup = {
    language: '_torrent',
    label: 'Torrent',
    files: subFiles.map(f => ({
      filename: f.name.split('/').pop(),
      url: `/api/movies/${props.movieId}/torrent-subtitle/${f.index}`,
      downloads: -1,
    })),
  };
  subtitleTracks.value = [torrentGroup, ...subtitleTracks.value];
  addAllTracksToPlayer();
}

function addAllTracksToPlayer() {
  if (!vjsPlayer) return;
  // Only run once — tracks persist in Video.js after first add
  if (addAllTracksToPlayer._done) return;
  if (subtitleTracks.value.length === 0) return;
  addAllTracksToPlayer._done = true;

  // Wait for player ready
  vjsPlayer.ready(() => {
    // Add every subtitle file as a separate Video.js text track
    for (const group of subtitleTracks.value) {
      for (const file of group.files) {
      const label = group.files.length > 1
        ? `${group.label} - ${file.filename}`
        : (group.label || group.language);
      const lang = group.language || 'en';

      const track = vjsPlayer.addTextTrack('subtitles', label, lang);

      // Lazy-load cues when track is shown
      const origMode = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(track), 'mode') ||
                        Object.getOwnPropertyDescriptor(track.__proto__.__proto__, 'mode');

      let loaded = false;
      track.addEventListener('cuechange', () => {}); // keep alive

      // Monitor mode changes to load cues on demand
      const checkAndLoad = async () => {
        if (track.mode === 'showing' && !loaded) {
          loaded = true;
          try {
            const resp = await fetch(file.url);
            const vtt = await resp.text();
            const blocks = vtt.split(/\n{2,}/);
            for (const block of blocks) {
              const lines = block.trim().split('\n');
              const tsIdx = lines.findIndex(l => l.includes('-->'));
              if (tsIdx === -1) continue;
              const [startStr, endStr] = lines[tsIdx].split('-->').map(s => s.trim());
              const text = lines.slice(tsIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
              if (!text) continue;
              const parseT = s => {
                const p = s.replace(',','.').split(':');
                return p.length === 3 ? parseInt(p[0])*3600+parseInt(p[1])*60+parseFloat(p[2]) : parseInt(p[0])*60+parseFloat(p[1]);
              };
              let cueText = text;
              if (isRTL(lang)) {
                // Fix punctuation: move leading ?!.,;:- to end of each line
                cueText = text.split('\n').map(line => {
                  const match = line.match(/^([?!.,;:\-]+)(.+)/);
                  return match ? match[2] + match[1] : line;
                }).join('\n');
                cueText = '\u202B' + cueText + '\u202C';
              }
              track.addCue(new VTTCue(parseT(startStr), parseT(endStr), cueText));
            }
            console.log('[subs] Loaded', track.cues.length, 'cues for', label);

            // Apply RTL to all cue rendering elements
            if (isRTL(lang)) {
              const el = vjsPlayer.el();
              const display = el.querySelector('.vjs-text-track-display');
              if (display) {
                display.style.direction = 'rtl';
                display.style.unicodeBidi = 'plaintext';
              }
              // Also inject a style for all cue divs
              if (!el.querySelector('#rtl-cue-style')) {
                const style = document.createElement('style');
                style.id = 'rtl-cue-style';
                style.textContent = '.vjs-text-track-display div { direction: rtl !important; unicode-bidi: plaintext !important; text-align: center !important; }';
                el.appendChild(style);
              }
            } else {
              const el = vjsPlayer.el();
              const display = el.querySelector('.vjs-text-track-display');
              if (display) { display.style.direction = ''; display.style.unicodeBidi = ''; }
              const rtlStyle = el.querySelector('#rtl-cue-style');
              if (rtlStyle) rtlStyle.remove();
            }
          } catch (err) {
            console.error('[subs] Failed to load', label, err);
          }
        }
      };

      // Poll for mode change since Video.js CC menu changes mode
      const interval = setInterval(() => {
        if (!vjsPlayer) { clearInterval(interval); return; }
        checkAndLoad();
      }, 500);
    } // end file loop
    } // end group loop
    console.log('[subs] Registered tracks for', subtitleTracks.value.length, 'languages');
  });

  // Listen for track changes to apply RTL and track active state
  const tt = vjsPlayer.textTracks();
  tt.addEventListener('change', () => {
    const display = vjsPlayer.el().querySelector('.vjs-text-track-display');
    let activeLang = null;
    for (let i = 0; i < tt.length; i++) {
      if (tt[i].mode === 'showing') { activeLang = tt[i].language; break; }
    }
    if (display && isRTL(activeLang)) {
      display.style.direction = 'rtl';
      display.style.unicodeBidi = 'bidi-override';
    } else if (display) {
      display.style.direction = '';
      display.style.unicodeBidi = '';
    }
    activeSubUrl.value = activeLang ? 'active' : null;
  });
}

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi', 'heb', 'ara', 'per', 'urd']);

function isRTL(lang) {
  return RTL_LANGS.has(lang?.toLowerCase());
}

function adjustOffset(delta) {
  subOffset.value = Math.round((subOffset.value + delta) * 10) / 10;
}


// When subtitle tracks change, update Video.js (debounced to avoid duplicates)
let addTracksTimer = null;
watch(subtitleTracks, () => {
  clearTimeout(addTracksTimer);
  addTracksTimer = setTimeout(() => addAllTracksToPlayer(), 500);
}, { deep: true });

async function autoSync() {
  if (syncing.value) return;
  const player = vjsPlayer;
  if (!player) return;
  const currentTime = player.currentTime();
  if (currentTime < 10) {
    alert('Whisper sync requires at least 10 seconds of playback. Seek forward and try again.');
    return;
  }

  // Get active track cues
  const tt = player.textTracks();
  let activeCues = [];
  let subLang = 'English';
  for (let i = 0; i < tt.length; i++) {
    if (tt[i].mode === 'showing' && tt[i].cues?.length) {
      activeCues = Array.from(tt[i].cues).map(c => ({ start: c.startTime, end: c.endTime, text: c.text.replace(/[\u202B\u202C]/g, '') }));
      subLang = tt[i].label || tt[i].language || 'English';
      break;
    }
  }
  if (!activeCues.length) { syncStatus.value = 'No active subtitle'; setTimeout(() => { syncStatus.value = ''; }, 3000); return; }

  syncing.value = true;
  syncStatus.value = 'Listening...';
  try {
    const { data } = await axios.post(`/api/movies/${props.movieId}/whisper-sync`, {
      currentTime,
      subtitleCues: activeCues,
      subtitleLanguage: subLang,
    }, { timeout: 180000 });

    subOffset.value = Math.round(data.offset * 10) / 10;
    const pct = Math.round(data.confidence * 100);
    syncStatus.value = `Synced: ${subOffset.value >= 0 ? '+' : ''}${subOffset.value.toFixed(1)}s (${pct}% confidence)`;
    setTimeout(() => { syncStatus.value = ''; }, 5000);
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    syncStatus.value = `Sync failed: ${msg}`;
    setTimeout(() => { syncStatus.value = ''; }, 8000);
  } finally {
    syncing.value = false;
  }
}

async function startPlayer() {
  if (!props.movieId) return;
  started.value = true;
  status.value = 'loading';
  activeMovieId.value = props.movieId;
  activeStreamUrl.value = `/api/movies/${props.movieId}/stream`;

  fetchSubtitlesForMovie();
  subtitlesFetched = false;

  await nextTick();

  // Init Video.js player
  if (videoEl.value && !vjsPlayer) {
    vjsPlayer = videojs(videoEl.value, {
      controls: true,
      autoplay: true,
      preload: 'auto',
      fluid: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      controlBar: {
        subsCapsButton: true,
      },
      userActions: {
        hotkeys: function(event) {
          // Left arrow: -5s, Right arrow: +5s
          if (event.which === 37) { this.currentTime(this.currentTime() - 5); }
          else if (event.which === 39) { this.currentTime(this.currentTime() + 5); }
          // Space: play/pause
          else if (event.which === 32) { this.paused() ? this.play() : this.pause(); }
        }
      },
      sources: [{ src: activeStreamUrl.value, type: 'video/mp4' }],
    });
    vjsPlayer.on('error', () => onVideoError());

    // Add skip buttons to control bar
    const Button = videojs.getComponent('Button');
    class SkipBackButton extends Button {
      handleClick() { vjsPlayer.currentTime(vjsPlayer.currentTime() - 5); }
      buildCSSClass() { return 'vjs-skip-back vjs-control vjs-button'; }
    }
    class SkipForwardButton extends Button {
      handleClick() { vjsPlayer.currentTime(vjsPlayer.currentTime() + 5); }
      buildCSSClass() { return 'vjs-skip-forward vjs-control vjs-button'; }
    }
    videojs.registerComponent('SkipBackButton', SkipBackButton);
    videojs.registerComponent('SkipForwardButton', SkipForwardButton);
    const skipBack = vjsPlayer.controlBar.addChild('SkipBackButton', {}, 1);
    skipBack.el().innerHTML = '<span class="vjs-icon-placeholder">-5s</span>';
    skipBack.el().title = 'Back 5s (←)';
    const skipFwd = vjsPlayer.controlBar.addChild('SkipForwardButton', {}, 2);
    skipFwd.el().innerHTML = '<span class="vjs-icon-placeholder">+5s</span>';
    skipFwd.el().title = 'Forward 5s (→)';
    // Add any already-fetched subtitle tracks
    if (subtitleTracks.value.length) addAllTracksToPlayer();
  }

  statsInterval = setInterval(pollStats, 2000);
  peerCheckTimer = setTimeout(checkPeers, 15000);
}

async function checkPeers() {
  if (peerCount.value > 0) return;

  status.value = 'searching';
  try {
    const { data } = await axios.get(`/api/movies/${props.movieId}/alt-sources`);
    if (data.dead || !data.alternatives || data.alternatives.length === 0) {
      status.value = 'dead';
    } else {
      altSources.value = data.alternatives;
      status.value = 'found';
    }
  } catch (err) {
    console.error('Alt sources error:', err);
    status.value = 'dead';
  }
}

async function switchToAlt(alt) {
  status.value = 'loading';
  altSources.value = [];

  // Update movie's magnet in DB, then re-stream
  try {
    await axios.patch(`/api/movies/${props.movieId}/magnet`, {
      torrent_magnet: alt.magnet,
      torrent_quality: alt.quality,
    });
  } catch {}

  activeStreamUrl.value = '';
  // Force re-render by toggling URL
  await new Promise(r => setTimeout(r, 100));
  activeStreamUrl.value = `/api/movies/${props.movieId}/stream?t=${Date.now()}`;

  if (peerCheckTimer) clearTimeout(peerCheckTimer);
  peerCheckTimer = setTimeout(checkPeers, 15000);
}

function onVideoError() {
  // Video failed — likely stream errored
  if (status.value === 'loading') {
    checkPeers();
  }
}

async function removeMovie() {
  if (!props.movieId) return;
  await axios.delete(`/api/movies/${props.movieId}`);
  router.push('/');
}

onUnmounted(() => {
  if (vjsPlayer) { vjsPlayer.dispose(); vjsPlayer = null; }
  if (statsInterval) clearInterval(statsInterval);
  if (peerCheckTimer) clearTimeout(peerCheckTimer);
  // Destroy torrent and delete cached files immediately
  if (activeMovieId.value) {
    axios.delete(`/api/movies/${activeMovieId.value}/stream`).catch(() => {});
  }
});
</script>

<style scoped>
.player-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  cursor: pointer;
  background: #0a0a1a;
  border-radius: 8px;
  transition: background 0.2s;
}
.player-start:hover { background: #111128; }
.loading-overlay {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px; background: #0a0a1a; border-radius: 8px;
}
.loading-spinner {
  width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { margin-top: 12px; color: var(--text-muted); font-size: 14px; }
.buffering-bar {
  position: relative; height: 20px; background: rgba(255,255,255,0.05);
  border-radius: 4px; overflow: hidden; margin-bottom: 4px;
}
.buffer-fill { height: 100%; background: rgba(119,190,65,0.3); transition: width 0.5s; }
.buffer-text {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  font-size: 11px; color: var(--text-muted);
}
.download-bar {
  height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; margin: 2px 0;
}
.download-fill { height: 100%; background: var(--accent); transition: width 1s; border-radius: 2px; }
.start-icon {
  font-size: 48px;
  margin-bottom: 12px;
  color: var(--accent);
}
.start-text {
  font-size: 16px;
  color: var(--text-dim);
}
.start-quality {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.05);
  padding: 4px 10px;
  border-radius: 4px;
}
.player-video {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
.video-wrap {
  position: relative;
}
.playback-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  flex-wrap: wrap;
}
.btn-playback {
  padding: 4px 10px;
  border-radius: 6px;
  background: #2a2a3e;
  color: #ccc;
  border: 1px solid #444;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-playback:hover { background: #3a3a5e; }
.speed-label {
  color: #888;
  font-size: 0.85rem;
  margin-left: 8px;
}
.btn-speed {
  padding: 3px 8px;
  border-radius: 6px;
  background: #2a2a3e;
  color: #ccc;
  border: 1px solid #444;
  cursor: pointer;
  font-size: 0.8rem;
}
.btn-speed:hover { background: #3a3a5e; }
.btn-speed.active { background: #4a6cf7; color: #fff; border-color: #4a6cf7; }

.subtitle-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  flex-wrap: wrap;
}
.subtitle-label {
  font-size: 13px;
  color: var(--text-muted);
  margin-right: 2px;
}
.btn-sub {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-dim);
  padding: 3px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.btn-sub:hover { background: rgba(255,255,255,0.1); }
.btn-sub.active {
  background: var(--accent, #77be41);
  color: #000;
  border-color: var(--accent, #77be41);
}
.file-count {
  font-size: 10px;
  opacity: 0.7;
}
.sub-picker {
  background: rgba(0,0,0,0.6);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 8px;
  margin: 4px 0;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sub-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.btn-close-picker {
  padding: 2px 6px !important;
  font-size: 10px !important;
}
.btn-sub-file {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text-dim);
  padding: 6px 10px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
  text-align: left;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.btn-sub-file:hover { background: rgba(255,255,255,0.08); }
.btn-sub-file.active {
  background: var(--accent, #77be41);
  color: #000;
  border-color: var(--accent, #77be41);
}
.btn-sub-file.active .sub-downloads { color: rgba(0,0,0,0.6); }
.sub-filename {
  word-break: break-all;
}
.best-match-badge {
  display: inline-block;
  margin-left: 6px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(119,190,65,0.2);
  color: var(--accent, #77be41);
  vertical-align: middle;
  white-space: nowrap;
}
.btn-sub-file.active .best-match-badge {
  background: rgba(0,0,0,0.2);
  color: rgba(0,0,0,0.7);
}
.sub-downloads {
  font-size: 10px;
  color: var(--text-muted);
}
.torrent-filename {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
  word-break: break-all;
}
.sync-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.sync-label {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 80px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.btn-sync {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-dim);
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
}
.btn-sync:hover { background: rgba(255,255,255,0.1); }
.btn-auto-sync {
  background: rgba(119,190,65,0.15);
  border-color: rgba(119,190,65,0.3);
  color: var(--accent, #77be41);
}
.btn-auto-sync:hover { background: rgba(119,190,65,0.25); }
.btn-auto-sync:disabled { opacity: 0.6; cursor: wait; }
.btn-sync-reset {
  margin-left: 4px;
  color: var(--text-muted);
}
.sync-status {
  font-size: 11px;
  color: var(--accent, #77be41);
  margin-left: 8px;
  opacity: 0.9;
}
.torrent-info {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-muted);
}
.fallback-msg {
  margin-top: 12px;
  padding: 12px 16px;
  background: rgba(255, 200, 0, 0.1);
  border: 1px solid rgba(255, 200, 0, 0.3);
  border-radius: 6px;
  color: #ffc800;
  font-size: 14px;
}
.fallback-dead {
  margin-top: 12px;
  padding: 16px;
  background: rgba(255, 60, 60, 0.1);
  border: 1px solid rgba(255, 60, 60, 0.3);
  border-radius: 6px;
  text-align: center;
}
.fallback-dead p {
  color: #ff7070;
  margin-bottom: 12px;
}
.fallback-alts {
  margin-top: 12px;
  padding: 16px;
  background: rgba(0, 200, 120, 0.07);
  border: 1px solid rgba(0, 200, 120, 0.2);
  border-radius: 6px;
}
.fallback-alts p {
  color: var(--text-dim);
  margin-bottom: 10px;
  font-size: 14px;
}
.alt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.btn-alt {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text);
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
}
.btn-alt:hover { background: rgba(255,255,255,0.1); }
.alt-size {
  color: var(--text-muted);
  margin-left: 8px;
  font-size: 12px;
}
.btn-danger {
  background: rgba(255, 60, 60, 0.2);
  border: 1px solid rgba(255, 60, 60, 0.4);
  color: #ff7070;
  padding: 8px 18px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s;
}
.btn-danger:hover { background: rgba(255, 60, 60, 0.35); }
</style>
