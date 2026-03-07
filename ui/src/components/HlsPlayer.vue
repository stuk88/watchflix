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
      <video
        v-show="!loading && !error"
        ref="videoEl"
        controls
        autoplay
        class="player-video"
      >
        <track
          v-for="track in subtitleTracks"
          :key="track.language"
          kind="subtitles"
          :label="track.label"
          :srclang="track.language"
          :src="track.url"
        />
      </video>
      <!-- Subtitle controls (shown when subtitles are available) -->
      <div v-if="!loading && !error && subtitleTracks.length" class="subtitle-bar">
        <span class="subtitle-label">CC:</span>
        <button
          class="btn btn-sub"
          :class="{ active: currentSubtitle === null }"
          @click="selectSubtitle(null)"
        >Off</button>
        <button
          v-for="track in subtitleTracks"
          :key="track.language"
          class="btn btn-sub"
          :class="{ active: currentSubtitle === track.language }"
          @click="selectSubtitle(track.language)"
        >{{ track.label }}</button>
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

let hls = null;

async function startPlayer() {
  started.value = true;
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
        fetchSubtitlesForMovie();
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
        fetchSubtitlesForMovie();
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
    // Default all tracks to hidden; user picks via selectSubtitle()
    await nextTick();
    if (videoEl.value) {
      const tracks = videoEl.value.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = 'hidden';
      }
    }
  } catch (err) {
    console.error('[hls-player] Subtitle fetch error:', err.message);
  }
}

function selectSubtitle(lang) {
  currentSubtitle.value = lang;
  if (!videoEl.value) return;
  const tracks = videoEl.value.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = tracks[i].language === lang ? 'showing' : 'hidden';
  }
}

async function switchServer(serverId) {
  currentServer.value = serverId;
  subtitleTracks.value = [];
  currentSubtitle.value = null;
  if (hls) {
    hls.destroy();
    hls = null;
  }
  await loadStream(serverId);
}

onUnmounted(() => {
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
.player-video {
  width: 100%;
  border-radius: 8px;
  background: #000;
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
</style>
