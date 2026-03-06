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

      <!-- Zero-peer fallback UI -->
      <div v-if="noPeerStatus === 'searching'" class="fallback-msg">
        No peers found. Searching for alternatives...
      </div>
      <div v-else-if="noPeerStatus === 'dead'" class="fallback-dead">
        <p>No sources available for this movie.</p>
        <button class="btn btn-danger" @click="removeMovie">🗑 Remove Movie</button>
      </div>
      <div v-else-if="noPeerStatus === 'found'" class="fallback-alts">
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
import { ref, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';

const props = defineProps({
  magnet: String,
  quality: String,
  movieId: [String, Number],
});

const router = useRouter();
const started = ref(false);
const videoEl = ref(null);
const downloadSpeed = ref('0 KB/s');
const uploadSpeed = ref('0 KB/s');
const peers = ref(0);
const progress = ref(0);

// 'idle' | 'searching' | 'found' | 'dead'
const noPeerStatus = ref('idle');
const altSources = ref([]);

let client = null;
let interval = null;
let peerCheckTimer = null;
let activeTorrent = null;

function formatSpeed(bytes) {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
}

async function checkPeers() {
  if (!activeTorrent || activeTorrent.numPeers > 0) return;

  noPeerStatus.value = 'searching';

  try {
    const { data } = await axios.get(`/api/movies/${props.movieId}/alt-sources`);
    if (data.dead || !data.alternatives?.length) {
      noPeerStatus.value = 'dead';
    } else {
      altSources.value = data.alternatives;
      noPeerStatus.value = 'found';
    }
  } catch {
    noPeerStatus.value = 'dead';
  }
}

async function switchToAlt(alt) {
  noPeerStatus.value = 'idle';
  altSources.value = [];

  // Destroy current torrent and restart with new magnet
  if (activeTorrent) activeTorrent.destroy();
  if (interval) clearInterval(interval);

  attachTorrent(alt.magnet);
}

function attachTorrent(magnetUri) {
  activeTorrent = null;
  client.add(magnetUri, (torrent) => {
    activeTorrent = torrent;
    const file = torrent.files.reduce((a, b) => a.length > b.length ? a : b);
    file.renderTo(videoEl.value, { autoplay: true });

    interval = setInterval(() => {
      downloadSpeed.value = formatSpeed(torrent.downloadSpeed);
      uploadSpeed.value = formatSpeed(torrent.uploadSpeed);
      peers.value = torrent.numPeers;
      progress.value = (torrent.progress * 100).toFixed(1);
    }, 1000);

    // Check for peers after 15 seconds
    if (props.movieId) {
      peerCheckTimer = setTimeout(checkPeers, 15000);
    }
  });
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
  attachTorrent(props.magnet);
}

async function removeMovie() {
  if (!props.movieId) return;
  await axios.delete(`/api/movies/${props.movieId}`);
  router.push('/');
}

onUnmounted(() => {
  if (interval) clearInterval(interval);
  if (peerCheckTimer) clearTimeout(peerCheckTimer);
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
