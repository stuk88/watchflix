<template>
  <div class="iframe-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">{{ icon }}</div>
      <div class="start-text">{{ label }}</div>
      <div class="start-quality">{{ qualityLabel }}</div>
    </div>

    <!-- HLS player for Russian sources (extracted stream URL) -->
    <div v-else-if="useHlsPlayer" class="hls-wrap">
      <div v-if="extracting" class="extracting-msg">Extracting stream...</div>
      <div v-else-if="extractError" class="extract-error">{{ extractError }}</div>
      <video
        v-else
        ref="hlsVideoEl"
        controls
        autoplay
        class="player-video"
      ></video>
    </div>

    <!-- Iframe for 123movies -->
    <div v-else class="iframe-wrap">
      <iframe
        ref="iframeEl"
        :src="sourceUrl"
        class="player-iframe"
        allowfullscreen
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        frameborder="0"
      ></iframe>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import Hls from 'hls.js';
import axios from 'axios';

const props = defineProps({
  sourceUrl: String,
  sourceName: { type: String, default: '123movies' },
  movieId: [String, Number],
});

const started = ref(false);
const iframeEl = ref(null);
const hlsVideoEl = ref(null);
const extracting = ref(false);
const extractError = ref('');
let hlsInstance = null;

const sourceLabels = {
  '123movies': { icon: '🌐', label: 'Watch Online', quality: '123movies · HD' },
  hdrezka: { icon: '🎬', label: 'Hdrezka', quality: 'Hdrezka · HD' },
  seazonvar: { icon: '📺', label: 'Seazonvar', quality: 'Seazonvar · HD' },
  filmix: { icon: '🎥', label: 'Filmix', quality: 'Filmix · HD' },
};

const hlsSources = ['hdrezka', 'seazonvar', 'filmix'];
const useHlsPlayer = computed(() => hlsSources.includes(props.sourceName));

const info = computed(() => sourceLabels[props.sourceName] || sourceLabels['123movies']);
const icon = computed(() => info.value.icon);
const label = computed(() => info.value.label);
const qualityLabel = computed(() => info.value.quality);

watch(() => props.sourceUrl, (newUrl, oldUrl) => {
  if (newUrl !== oldUrl) {
    destroyHls();
    started.value = false;
    extractError.value = '';
  }
});

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
}

async function startPlayer() {
  started.value = true;

  if (useHlsPlayer.value && props.movieId) {
    extracting.value = true;
    extractError.value = '';
    try {
      const endpointMap = {
        hdrezka: 'hdrezka-stream',
        seazonvar: 'seazonvar-stream',
        filmix: 'filmix-stream',
      };
      const endpoint = endpointMap[props.sourceName] || 'hdrezka-stream';
      const { data } = await axios.get(`/api/movies/${props.movieId}/${endpoint}`);
      if (!data.streamUrl) throw new Error('No stream URL returned');

      // Stop extracting so the <video> element renders
      extracting.value = false;
      await nextTick();

      const video = hlsVideoEl.value;
      if (!video) return;

      if (data.streamUrl.includes('.m3u8') && Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(data.streamUrl);
        hlsInstance.attachMedia(video);
      } else {
        // Fallback: direct URL (mp4 or native HLS on Safari)
        video.src = data.streamUrl;
      }
    } catch (err) {
      extracting.value = false;
      extractError.value = 'Failed to extract stream: ' + (err.response?.data?.error || err.message);
    }
  }
}

onUnmounted(() => {
  destroyHls();
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
  transition: background 0.2s;
}
.player-start:hover { background: #111128; }
.start-icon { font-size: 48px; margin-bottom: 12px; }
.start-text { font-size: 16px; color: var(--text-dim); }
.start-quality {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.05);
  padding: 4px 10px;
  border-radius: 4px;
}
.iframe-wrap, .hls-wrap {
  width: 100%;
  background: #000;
}
.player-iframe {
  width: 100%;
  height: 100vh;
  border: none;
  display: block;
}
.player-video {
  width: 100%;
  max-height: 100vh;
  background: #000;
  display: block;
}
.extracting-msg {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-muted);
  font-size: 16px;
}
.extract-error {
  padding: 20px;
  color: #ff7070;
  text-align: center;
}
@media (max-width: 768px) {
  .player-start { min-height: 200px; }
  .start-icon { font-size: 36px; }
  .player-iframe, .player-video { max-height: 60vh; }
}
</style>
