<template>
  <div class="torrent-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">▶</div>
      <div class="start-text">Start Streaming</div>
      <div class="start-quality" v-if="quality">{{ quality }}</div>
    </div>
    <div v-else>
      <div class="video-wrap">
        <video
          ref="videoEl"
          class="player-video"
          :src="streamUrl"
          @error="onVideoError"
        ></video>
      </div>
      <!-- Subtitle controls -->
      <div class="subtitle-bar">
        <span class="subtitle-label">CC:</span>
        <button class="btn btn-sub" :class="{ active: currentSubtitle === null && !showSubPicker }" @click="selectSubtitleFile(null); showSubPicker = false;">Off</button>
        <button
          v-for="track in subtitleTracks"
          :key="track.language"
          class="btn btn-sub"
          :class="{ active: currentSubtitle === track.language }"
          @click="toggleLangPicker(track.language)"
        >{{ track.label }} <span v-if="track.files.length > 1" class="file-count">({{ track.files.length }})</span></button>
        <label class="btn btn-sub btn-local-file">
          📂 Local File
          <input type="file" accept=".srt,.vtt,.sub,.ass" style="display:none" @change="loadLocalSubtitleFile" />
        </label>
      </div>
      <!-- Subtitle file picker (when language has multiple files) -->
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
          <span class="sub-filename">
            {{ file.filename }}
            <span v-if="file.isBestMatch" class="best-match-badge">★ Best match</span>
          </span>
          <span v-if="file.downloads >= 0" class="sub-downloads">{{ file.downloads.toLocaleString() }} downloads</span>
          <span v-else class="sub-downloads">📦 from torrent</span>
        </button>
      </div>
      <!-- Subtitle sync controls -->
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
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';

const props = defineProps({
  magnet: String,
  quality: String,
  movieId: [String, Number],
});

const router = useRouter();
const started = ref(false);
const videoEl = ref(null);
let plyrInstance = null;
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
const currentSubtitle = ref(null);
const showSubPicker = ref(false);
const pickerFiles = ref([]);
const activeSubUrl = ref(null);
const torrentFilename = ref('');
const subOffset = ref(0);
const syncing = ref(false);
const syncStatus = ref('');
let subtitleCues = [];
let activeTrack = null;

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
  } catch (err) {
    console.error('[torrent-player] Subtitle fetch error:', err.message);
  }
}

function addTorrentSubtitleFiles(subFiles) {
  // Parse language from filename, e.g. "Movie.en.srt" or "Subs/English.srt"
  const torrentGroup = {
    language: '_torrent',
    label: '📦 Torrent',
    files: subFiles.map(f => {
      // Try to extract lang hint from filename
      const name = f.name.split('/').pop();
      return {
        filename: name,
        url: `/api/movies/${props.movieId}/torrent-subtitle/${f.index}`,
        downloads: -1, // marker for torrent files
      };
    }),
  };
  // Prepend torrent subs so they appear first
  subtitleTracks.value = [torrentGroup, ...subtitleTracks.value];
}

function parseVTT(vttText) {
  const cues = [];
  const blocks = vttText.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
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
  const parts = str.replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
}

function clearSubtitleTrack() {
  if (activeTrack) {
    activeTrack.mode = 'disabled';
    activeTrack = null;
  }
  subtitleCues = [];
}

function applyCuesToTrack() {
  if (!videoEl.value || !subtitleCues.length) return;
  // Remove old track
  if (activeTrack) {
    activeTrack.mode = 'disabled';
  }
  // Create new track
  const track = videoEl.value.addTextTrack('subtitles', 'Subtitles', 'en');
  track.mode = 'showing';
  for (const cue of subtitleCues) {
    const start = Math.max(0, cue.start - subOffset.value);
    const end = Math.max(0, cue.end - subOffset.value);
    if (end > start) {
      track.addCue(new VTTCue(start, end, cue.text));
    }
  }
  activeTrack = track;
}

function dotSimilarity(a, b) {
  if (!a || !b) return 0;
  const partsA = a.toLowerCase().replace(/\.[^.]+$/, '').split('.');
  const partsB = b.toLowerCase().replace(/\.[^.]+$/, '').split('.');
  const setB = new Set(partsB);
  return partsA.filter(p => p.length > 1 && setB.has(p)).length;
}

function markBestMatch(files, referenceFilename) {
  if (!referenceFilename || files.length <= 1) return files;
  const scores = files.map(f => dotSimilarity(f.filename, referenceFilename));
  const maxScore = Math.max(...scores);
  if (maxScore === 0) return files;
  const bestIdx = scores.indexOf(maxScore);
  return files.map((f, i) => ({ ...f, isBestMatch: i === bestIdx }));
}

function toggleLangPicker(lang) {
  const track = subtitleTracks.value.find(t => t.language === lang);
  if (!track) return;

  if (track.files.length === 1) {
    // Single file — select immediately
    currentSubtitle.value = lang;
    showSubPicker.value = false;
    selectSubtitleFile(track.files[0]);
    return;
  }

  // Multiple files — show picker, mark best match by filename similarity
  currentSubtitle.value = lang;
  pickerFiles.value = markBestMatch(track.files, torrentFilename.value);
  showSubPicker.value = true;
}

async function selectSubtitleFile(file) {
  clearSubtitleTrack();
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
    // file.url can be a network URL or a local blob URL
    const response = await fetch(file.url);
    const vttText = await response.text();
    subtitleCues = parseVTT(vttText);
    applyCuesToTrack();
  } catch (err) {
    console.error('[subtitles] Failed to load VTT:', err);
  }
}

function loadLocalSubtitleFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let text = reader.result;
    // Convert SRT to VTT if needed
    if (file.name.endsWith('.srt')) {
      text = 'WEBVTT\n\n' + text
        .replace(/\r\n/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        .replace(/^\d+\n/gm, '');
    }
    clearSubtitleTrack();
    subOffset.value = 0;
    currentSubtitle.value = '_local';
    activeSubUrl.value = 'local://' + file.name;
    subtitleCues = parseVTT(text);
    applyCuesToTrack();
  };
  reader.readAsText(file);
}

function adjustOffset(delta) {
  subOffset.value = Math.round((subOffset.value + delta) * 10) / 10;
}


watch(subOffset, () => {
  if (subtitleCues.length && activeSubUrl.value) {
    applyCuesToTrack();
  }
});

async function autoSync() {
  if (!activeSubUrl.value || syncing.value) return;
  const currentTime = videoEl.value?.currentTime ?? 0;
  if (currentTime < 10) {
    alert('Whisper sync requires at least 10 seconds of playback. Seek forward and try again.');
    return;
  }

  syncing.value = true;
  syncStatus.value = 'Listening...';

  // Send ALL subtitle cues — offset might be way off so windowing would miss the match
  const allCues = subtitleCues.map(c => ({ start: c.start, end: c.end, text: c.text }));

  // Determine subtitle language label
  const subTrack = subtitleTracks.value.find(t => t.language === currentSubtitle.value);
  const subLang = subTrack?.label || subTrack?.language || 'English';

  try {
    const { data } = await axios.post(`/api/movies/${props.movieId}/whisper-sync`, {
      currentTime,
      subtitleCues: allCues,
      subtitleLanguage: subLang,
    }, { timeout: 180000 });

    subOffset.value = Math.round(data.offset * 10) / 10;
    const pct = Math.round(data.confidence * 100);
    syncStatus.value = `Synced: ${subOffset.value >= 0 ? '+' : ''}${subOffset.value.toFixed(1)}s (${pct}% confidence)`;
    setTimeout(() => { syncStatus.value = ''; }, 5000);
  } catch (err) {
    console.error('[whisper-sync] Failed:', err);
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

  // Init Plyr on the video element
  if (videoEl.value && !plyrInstance) {
    plyrInstance = new Plyr(videoEl.value, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'fullscreen'],
      settings: ['captions', 'quality', 'speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      autoplay: true,
    });
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
  if (plyrInstance) { plyrInstance.destroy(); plyrInstance = null; }
  clearSubtitleTrack();
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
