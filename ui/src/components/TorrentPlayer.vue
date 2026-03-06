<template>
  <div class="torrent-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">▶</div>
      <div class="start-text">Start Streaming</div>
      <div class="start-quality" v-if="quality">{{ quality }}</div>
    </div>
    <div v-else>
      <video
        ref="videoEl"
        controls
        autoplay
        class="player-video"
        :src="streamUrl"
        @error="onVideoError"
      ></video>
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
import { ref, onUnmounted, computed } from 'vue';
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

const streamUrl = computed(() => activeStreamUrl.value);

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
    }
  } catch {}
}

function startPlayer() {
  if (!props.movieId) return;
  started.value = true;
  status.value = 'loading';
  activeMovieId.value = props.movieId;
  activeStreamUrl.value = `/api/movies/${props.movieId}/stream`;

  // Poll stats every 2s
  statsInterval = setInterval(pollStats, 2000);

  // Check for peers after 15s
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
  if (statsInterval) clearInterval(statsInterval);
  if (peerCheckTimer) clearTimeout(peerCheckTimer);
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
