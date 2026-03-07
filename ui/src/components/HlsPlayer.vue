<template>
  <div class="hls-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">🌐</div>
      <div class="start-text">Watch Online</div>
      <div class="start-quality">123movies · HD</div>
    </div>
    <div v-else>
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <div class="loading-text">{{ loadingText }}</div>
      </div>
      <div v-show="!loading && !error" class="video-wrap">
        <video
          ref="videoEl"
          controls
          autoplay
          class="player-video"
        ></video>
        <!-- Custom subtitle overlay (works with hls.js which ignores <track> elements) -->
        <div v-if="currentSubtitleText" class="subtitle-overlay" v-html="currentSubtitleText"></div>
      </div>
      <!-- Subtitle controls (shown when subtitles are available, even while stream is loading) -->
      <div v-if="!error && subtitleTracks.length" class="subtitle-bar">
        <span class="subtitle-label">CC:</span>
        <button
          class="btn btn-sub"
          :class="{ active: currentSubtitle === null && !showSubPicker }"
          @click="selectSubtitleFile(null); showSubPicker = false;"
        >Off</button>
        <button
          v-for="track in subtitleTracks"
          :key="track.language"
          class="btn btn-sub"
          :class="{ active: currentSubtitle === track.language }"
          @click="toggleLangPicker(track.language)"
        >{{ track.label }} <span v-if="track.files && track.files.length > 1" class="file-count">({{ track.files.length }})</span></button>
      </div>
      <div v-if="showSubPicker && pickerFiles.length" class="sub-picker">
        <div class="sub-picker-header">
          <span>Choose subtitle file:</span>
          <button class="btn btn-sub btn-close-picker" @click="showSubPicker = false">✕</button>
        </div>
        <button
          v-for="(file, i) in pickerFiles"
          :key="i"
          class="btn btn-sub-file"
          :class="{ active: activeSubUrl === file.url }"
          @click="selectSubtitleFile(file)"
        >
          <span class="sub-filename">{{ file.filename }}</span>
          <span class="sub-downloads">{{ file.downloads.toLocaleString() }} downloads</span>
        </button>
      </div>
      <!-- Subtitle sync controls -->
      <div v-if="activeSubUrl" class="sync-bar">
        <button class="btn btn-sync" @click="adjustOffset(-5)">-5s</button>
        <button class="btn btn-sync" @click="adjustOffset(-0.5)">-0.5s</button>
        <span class="sync-label">Sync: {{ subOffset >= 0 ? '+' : '' }}{{ subOffset.toFixed(1) }}s</span>
        <button class="btn btn-sync" @click="adjustOffset(0.5)">+0.5s</button>
        <button class="btn btn-sync" @click="adjustOffset(5)">+5s</button>
        <button class="btn btn-sync btn-sync-reset" @click="adjustOffset(-subOffset)">Reset</button>
      </div>
      <div v-if="error" class="error-state">
        <p>{{ error }}</p>
        <div v-if="servers.length" class="server-switch">
          <p class="server-label">Try a different server:</p>
          <div class="server-list">
            <button
              v-for="srv in servers"
              :key="srv.id"
              class="btn btn-server"
              :class="{ active: srv.id === currentServer }"
              @click="switchServer(srv.id)"
            >
              {{ srv.name }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="!loading && !error && servers.length" class="server-bar">
        <span class="server-label-inline">Server:</span>
        <button
          v-for="srv in servers"
          :key="srv.id"
          class="btn btn-server-sm"
          :class="{ active: srv.id === currentServer }"
          @click="switchServer(srv.id)"
        >
          {{ srv.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted, nextTick } from 'vue';
import axios from 'axios';

const props = defineProps({
  movieId: [String, Number],
});

const started = ref(false);
const loading = ref(false);
const loadingText = ref('Extracting stream...');
const error = ref(null);
const videoEl = ref(null);
const servers = ref([]);
const currentServer = ref(2);
const subtitleTracks = ref([]);
const currentSubtitle = ref(null);
const currentSubtitleText = ref('');
const showSubPicker = ref(false);
const pickerFiles = ref([]);
const activeSubUrl = ref(null);
const subOffset = ref(0);

let hls = null;
let subtitleCues = [];
let timeUpdateListener = null;

async function startPlayer() {
  started.value = true;
  fetchSubtitlesForMovie(); // fire immediately, don't await
  await loadStream(currentServer.value);
}

async function loadStream(server) {
  loading.value = true;
  error.value = null;
  loadingText.value = 'Extracting stream from 123movies...';

  try {
    const { data } = await axios.get(`/api/movies/${props.movieId}/123stream?server=${server}`);

    if (data.servers) {
      servers.value = data.servers;
    }

    if (!data.m3u8) {
      throw new Error('No stream URL returned');
    }

    loadingText.value = 'Loading video...';

    // Build proxied m3u8 URL
    const proxyUrl = `/api/movies/${props.movieId}/123proxy?url=${encodeURIComponent(data.m3u8)}`;

    await nextTick();

    // Try native HLS (Safari) first
    if (videoEl.value?.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.value.src = proxyUrl;
      videoEl.value.addEventListener('loadedmetadata', () => {
        loading.value = false;
      }, { once: true });
      videoEl.value.addEventListener('error', () => {
        error.value = 'Failed to play stream. Try another server.';
        loading.value = false;
      }, { once: true });
    } else {
      // Use hls.js for Chrome/Firefox
      const Hls = (await import('hls.js')).default;
      if (!Hls.isSupported()) {
        throw new Error('HLS not supported in this browser');
      }

      if (hls) {
        hls.destroy();
      }

      hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hls.loadSource(proxyUrl);
      hls.attachMedia(videoEl.value);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        loading.value = false;
        videoEl.value?.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('[hls] Fatal error:', data.type, data.details);
          error.value = 'Stream error. Try another server.';
          loading.value = false;
          hls.destroy();
          hls = null;
        }
      });
    }
  } catch (err) {
    console.error('[hls-player] Error:', err);
    error.value = err.response?.data?.error || err.message || 'Failed to load stream';
    loading.value = false;
  }
}

async function fetchSubtitlesForMovie() {
  try {
    const { data } = await axios.get(`/api/movies/${props.movieId}/subtitles`);
    subtitleTracks.value = data.tracks || [];
  } catch (err) {
    console.error('[hls-player] Subtitle fetch error:', err.message);
  }
}

// Parse WebVTT into cue objects { start, end, text }
function parseVTT(vttText) {
  const cues = [];
  // Split into blocks separated by blank lines
  const blocks = vttText.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    // Find the timestamp line
    const tsIdx = lines.findIndex(l => l.includes('-->'));
    if (tsIdx === -1) continue;
    const [startStr, endStr] = lines[tsIdx].split('-->').map(s => s.trim());
    const text = lines.slice(tsIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    cues.push({ start: parseVTTTime(startStr), end: parseVTTTime(endStr), text });
  }
  return cues;
}

function parseVTTTime(str) {
  // Handles HH:MM:SS.mmm and MM:SS.mmm
  const parts = str.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
}

function clearSubtitleListener() {
  if (timeUpdateListener && videoEl.value) {
    videoEl.value.removeEventListener('timeupdate', timeUpdateListener);
    timeUpdateListener = null;
  }
  subtitleCues = [];
  currentSubtitleText.value = '';
}

function toggleLangPicker(lang) {
  const track = subtitleTracks.value.find(t => t.language === lang);
  if (!track) return;

  if (!track.files || track.files.length === 1) {
    currentSubtitle.value = lang;
    showSubPicker.value = false;
    selectSubtitleFile(track.files ? track.files[0] : { url: track.url });
    return;
  }

  currentSubtitle.value = lang;
  pickerFiles.value = track.files;
  showSubPicker.value = true;
}

async function selectSubtitleFile(file) {
  clearSubtitleListener();
  subOffset.value = 0;

  if (!file) {
    currentSubtitle.value = null;
    activeSubUrl.value = null;
    showSubPicker.value = false;
    return;
  }

  activeSubUrl.value = file.url;
  showSubPicker.value = false;

  try {
    const response = await fetch(file.url);
    const vttText = await response.text();
    subtitleCues = parseVTT(vttText);

    timeUpdateListener = () => {
      const time = (videoEl.value?.currentTime ?? 0) + subOffset.value;
      const cue = subtitleCues.find(c => time >= c.start && time <= c.end);
      currentSubtitleText.value = cue ? cue.text : '';
    };
    videoEl.value?.addEventListener('timeupdate', timeUpdateListener);
  } catch (err) {
    console.error('[subtitles] Failed to load VTT:', err);
  }
}

function adjustOffset(delta) {
  subOffset.value = Math.round((subOffset.value + delta) * 10) / 10;
}

async function switchServer(serverId) {
  currentServer.value = serverId;
  subtitleTracks.value = [];
  currentSubtitle.value = null;
  clearSubtitleListener();
  if (hls) {
    hls.destroy();
    hls = null;
  }
  await loadStream(serverId);
}

onUnmounted(() => {
  clearSubtitleListener();
  if (hls) {
    hls.destroy();
    hls = null;
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
.start-icon {
  font-size: 48px;
  margin-bottom: 12px;
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
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: #0a0a1a;
  border-radius: 8px;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: var(--accent, #77be41);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: var(--text-muted);
}
.video-wrap {
  position: relative;
}
.player-video {
  width: 100%;
  border-radius: 8px;
  background: #000;
}
.subtitle-overlay {
  position: absolute;
  bottom: 60px; /* above the video controls bar */
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  text-align: center;
  color: #fff;
  font-size: 16px;
  line-height: 1.4;
  text-shadow: 0 0 4px #000, 0 1px 3px #000;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 10px;
  border-radius: 4px;
  pointer-events: none;
  white-space: pre-line;
}
.error-state {
  padding: 24px;
  text-align: center;
  background: rgba(255, 60, 60, 0.08);
  border: 1px solid rgba(255, 60, 60, 0.2);
  border-radius: 8px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.error-state p {
  color: #ff7070;
  margin-bottom: 16px;
  font-size: 15px;
}
.server-switch {
  margin-top: 8px;
}
.server-label {
  color: var(--text-dim);
  font-size: 13px;
  margin-bottom: 8px;
}
.server-list {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.btn-server, .btn-server-sm {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--text-dim);
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.btn-server:hover, .btn-server-sm:hover {
  background: rgba(255,255,255,0.1);
}
.btn-server.active, .btn-server-sm.active {
  background: var(--accent, #77be41);
  color: #000;
  border-color: var(--accent, #77be41);
}
.server-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}
.server-label-inline {
  font-size: 13px;
  color: var(--text-muted);
}
.btn-server-sm {
  padding: 4px 10px;
  font-size: 12px;
}
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
.btn-sub:hover {
  background: rgba(255,255,255,0.1);
}
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
.sub-downloads {
  font-size: 10px;
  color: var(--text-muted);
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
.btn-sync-reset {
  margin-left: 4px;
  color: var(--text-muted);
}
</style>
