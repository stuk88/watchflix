<template>
  <div class="movie-detail" v-if="movie">
    <router-link to="/" class="back-link">← Back to movies</router-link>

    <div class="movie-hero">
      <div class="hero-poster">
        <img :src="movie.poster || '/placeholder.svg'" :alt="movie.title" />
      </div>
      <div class="hero-info">
        <h1 class="hero-title">{{ movie.title }}</h1>
        <div class="hero-meta">
          <span v-if="movie.year">{{ movie.year }}</span>
          <span v-if="movie.runtime">{{ movie.runtime }}</span>
          <span v-if="movie.genre" style="color: var(--accent)">{{ movie.genre }}</span>
          <span class="source-badge" :class="sourceClass">{{ sourceLabel }}</span>
        </div>

        <div class="ratings-panel">
          <div class="rating-item" v-if="movie.imdb_rating">
            <span class="rating-label" style="background:#f5c518;color:#000;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:800">IMDb</span>
            <span class="rating-score" :class="ratingClass(movie.imdb_rating * 10)">{{ movie.imdb_rating }}</span>
            <span class="rating-max">/10</span>
          </div>
          <div class="rating-item" v-if="movie.rt_rating">
            <span class="rating-label">🍅</span>
            <span class="rating-score" :class="ratingClass(parseInt(movie.rt_rating))">{{ movie.rt_rating }}</span>
          </div>
          <div class="rating-item" v-if="movie.meta_rating">
            <span class="rating-label" style="color:#fc3;font-weight:800">M</span>
            <span class="rating-score" :class="ratingClass(movie.meta_rating)">{{ movie.meta_rating }}</span>
            <span class="rating-max">/100</span>
          </div>
        </div>

        <p class="hero-plot" v-if="movie.plot">{{ movie.plot }}</p>

        <div class="hero-meta" v-if="movie.director">
          <strong>Director:</strong> {{ movie.director }}
        </div>
        <div class="hero-meta" v-if="movie.actors">
          <strong>Cast:</strong> {{ movie.actors }}
        </div>

        <div class="hero-actions">
          <button class="btn btn-outline" :class="{ active: movie.is_favorite }" @click="toggleFav">
            {{ movie.is_favorite ? '★ Favorited' : '☆ Add to Favorites' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Source Tabs -->
    <div class="source-tabs" v-if="hasBothSources">
      <button class="source-tab" :class="{ active: activeTab === '123movies' }" @click="activeTab = '123movies'">
        🎬 Stream (123Movies)
      </button>
      <button class="source-tab" :class="{ active: activeTab === 'torrent' }" @click="activeTab = 'torrent'">
        🧲 Torrent (WebTorrent)
      </button>
    </div>

    <!-- 123Movies Player -->
    <div v-if="show123" class="player-area">
      <iframe :src="movie.source_url" allowfullscreen></iframe>
    </div>

    <!-- Torrent Player -->
    <div v-if="showTorrent">
      <TorrentPlayer :magnet="movie.torrent_magnet" :quality="movie.torrent_quality" :movie-id="movie.id" />
    </div>

    <!-- Single source buttons -->
    <div v-if="!hasBothSources">
      <div v-if="movie.source_url" class="player-area">
        <iframe :src="movie.source_url" allowfullscreen></iframe>
      </div>
      <TorrentPlayer v-else-if="movie.torrent_magnet" :magnet="movie.torrent_magnet" :quality="movie.torrent_quality" :movie-id="movie.id" />
      <div v-else class="empty-state">
        <p>No streaming source available</p>
      </div>
    </div>
  </div>

  <div v-else class="loading">Loading movie...</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import TorrentPlayer from '../components/TorrentPlayer.vue';

const route = useRoute();
const movie = ref(null);
const activeTab = ref('123movies');

onMounted(async () => {
  const { data } = await axios.get(`/api/movies/${route.params.id}`);
  movie.value = data;

  // Mark as watched
  axios.patch(`/api/movies/${route.params.id}/watched`);

  // Default to available source
  if (data.source === 'torrent') activeTab.value = 'torrent';
  else activeTab.value = '123movies';
});

const hasBothSources = computed(() => movie.value?.source === 'both');
const show123 = computed(() => hasBothSources.value && activeTab.value === '123movies');
const showTorrent = computed(() => hasBothSources.value && activeTab.value === 'torrent');

const sourceClass = computed(() => {
  const s = movie.value?.source;
  if (s === 'both') return 'sboth';
  if (s === 'torrent') return 'storrent';
  return 's123';
});

const sourceLabel = computed(() => {
  const s = movie.value?.source;
  if (s === 'both') return 'Both Sources';
  if (s === 'torrent') return 'Torrent';
  return '123Movies';
});

function ratingClass(score) {
  if (score >= 70) return 'good';
  if (score >= 40) return 'mid';
  return 'bad';
}

async function toggleFav() {
  const { data } = await axios.patch(`/api/movies/${movie.value.id}/favorite`);
  movie.value.is_favorite = data.is_favorite;
}
</script>
