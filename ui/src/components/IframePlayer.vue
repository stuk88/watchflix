<template>
  <div class="iframe-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">{{ icon }}</div>
      <div class="start-text">{{ label }}</div>
      <div class="start-quality">{{ qualityLabel }}</div>
    </div>
    <div v-else class="iframe-wrap">
      <!-- Use webview for Russian sources (handles Cloudflare), iframe for 123movies -->
      <webview
        v-if="useWebview"
        ref="webviewEl"
        :src="sourceUrl"
        class="player-iframe"
        allowpopups="false"
        disablewebsecurity
      ></webview>
      <iframe
        v-else
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
import { ref, computed, watch } from 'vue';

const props = defineProps({
  sourceUrl: String,
  sourceName: { type: String, default: '123movies' },
});

const started = ref(false);
const iframeEl = ref(null);

const sourceLabels = {
  '123movies': { icon: '🌐', label: 'Watch Online', quality: '123movies · HD' },
  hdrezka: { icon: '🎬', label: 'Hdrezka', quality: 'Hdrezka · HD' },
  seazonvar: { icon: '📺', label: 'Seazonvar', quality: 'Seazonvar · HD' },
  filmix: { icon: '🎥', label: 'Filmix', quality: 'Filmix · HD' },
};

const russianSources = ['hdrezka', 'seazonvar', 'filmix'];
const useWebview = computed(() => russianSources.includes(props.sourceName));

const info = computed(() => sourceLabels[props.sourceName] || sourceLabels['123movies']);
const icon = computed(() => info.value.icon);
const label = computed(() => info.value.label);
const qualityLabel = computed(() => info.value.quality);

watch(() => props.sourceUrl, (newUrl, oldUrl) => {
  if (newUrl !== oldUrl) {
    started.value = false;
  }
});

function startPlayer() {
  started.value = true;
}
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
.iframe-wrap {
  width: 100%;
  background: #000;
  overflow: hidden;
}
.player-iframe {
  width: 100%;
  height: 100vh;
  border: none;
  display: block;
}
@media (max-width: 768px) {
  .player-start { min-height: 200px; }
  .start-icon { font-size: 36px; }
  .player-iframe { height: 100vh; }
}
@media (max-width: 480px) {
  .player-iframe { height: 100vh; }
}
</style>
