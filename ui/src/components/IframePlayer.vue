<template>
  <div class="iframe-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">🌐</div>
      <div class="start-text">Watch Online</div>
      <div class="start-quality">123movies · HD</div>
    </div>
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
import { ref } from 'vue';

defineProps({
  sourceUrl: String,
});

const started = ref(false);
const iframeEl = ref(null);

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
  border-radius: 8px;
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
  border-radius: 8px;
  overflow: hidden;
}
.player-iframe {
  width: 100%;
  height: 80vh;
  border: none;
  display: block;
}
@media (max-width: 768px) {
  .player-start { min-height: 200px; }
  .start-icon { font-size: 36px; }
  .player-iframe { height: 60vh; }
}
@media (max-width: 480px) {
  .player-iframe { height: 50vh; }
}
</style>
