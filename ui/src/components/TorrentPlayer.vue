<template>
  <div class="torrent-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">▶</div>
      <div class="start-text">Start Streaming via WebTorrent</div>
      <div class="start-quality" v-if="quality">{{ quality }}</div>
    </div>
    <div v-else>
      <video ref="videoEl" controls autoplay class="player-video"></video>
      <div class="torrent-info">
        <span>⬇ {{ downloadSpeed }}</span>
        <span>⬆ {{ uploadSpeed }}</span>
        <span>👥 {{ peers }} peers</span>
        <span>📊 {{ progress }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';

const props = defineProps({
  magnet: String,
  quality: String,
});

const started = ref(false);
const videoEl = ref(null);
const downloadSpeed = ref('0 KB/s');
const uploadSpeed = ref('0 KB/s');
const peers = ref(0);
const progress = ref(0);

let client = null;
let interval = null;

function formatSpeed(bytes) {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

async function startPlayer() {
  if (!props.magnet) return;
  started.value = true;

  // Dynamic import WebTorrent (browser bundle)
  const WebTorrent = (await import('https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js')).default
    || window.WebTorrent;

  if (!WebTorrent) {
    console.error('WebTorrent not loaded');
    return;
  }

  client = new WebTorrent();
  client.add(props.magnet, (torrent) => {
    // Find the largest video file
    const file = torrent.files.reduce((a, b) => a.length > b.length ? a : b);

    // Stream to video element
    file.renderTo(videoEl.value, { autoplay: true });

    // Update stats
    interval = setInterval(() => {
      downloadSpeed.value = formatSpeed(torrent.downloadSpeed);
      uploadSpeed.value = formatSpeed(torrent.uploadSpeed);
      peers.value = torrent.numPeers;
      progress.value = (torrent.progress * 100).toFixed(1);
    }, 1000);
  });
}

onUnmounted(() => {
  if (interval) clearInterval(interval);
  if (client) client.destroy();
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
</style>
