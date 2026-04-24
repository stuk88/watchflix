<template>
  <div class="content movie-detail" v-if="movie">
    <router-link to="/" class="back-link">← Back to movies</router-link>

    <div class="movie-hero">
      <div class="hero-poster">
        <img :src="movie.poster || '/placeholder.svg'" :alt="movie.title" />
      </div>
      <div class="hero-info">
        <h1 class="hero-title">
          {{ movie.title_en || movie.title }}
          <span v-if="isSeries" class="tv-badge">📺 TV Series</span>
        </h1>
        <div v-if="movie.title_en && movie.title_en !== movie.title" class="hero-title-ru">{{ movie.title }}</div>
        <div class="hero-meta">
          <span v-if="movie.year">{{ movie.year }}</span>
          <span v-if="movie.runtime">{{ movie.runtime }}</span>
          <span v-if="movie.genre" style="color: var(--accent)">{{ movie.genre }}</span>
          <span class="source-badge" :class="sourceClass">{{ sourceLabel }}</span>
          <span v-if="movie.offline_path" class="offline-badge-hero">💾 Offline</span>
        </div>

        <div class="ratings-panel">
          <div class="rating-item" :class="{ 'rating-primary': moviesStore.ratingProvider === 'imdb' }" v-if="movie.imdb_rating">
            <span class="rating-label" style="background:#f5c518;color:#000;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:800">IMDb</span>
            <span class="rating-score" :class="ratingClass(movie.imdb_rating * 10)">{{ movie.imdb_rating }}</span>
            <span class="rating-max">/10</span>
          </div>
          <div class="rating-item" :class="{ 'rating-primary': moviesStore.ratingProvider === 'rt' }" v-if="movie.rt_rating">
            <span class="rating-label">🍅</span>
            <span class="rating-score" :class="ratingClass(parseInt(movie.rt_rating))">{{ movie.rt_rating }}</span>
          </div>
          <div class="rating-item" :class="{ 'rating-primary': moviesStore.ratingProvider === 'meta' }" v-if="movie.meta_rating">
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

        <CriticScores :movie-id="movie.id" />
      </div>
    </div>

    <!-- Season tabs (series only, when multiple seasons) -->
    <div v-if="isSeries && seasonNumbers.length > 1" class="source-tabs season-tabs">
      <button
        v-for="s in seasonNumbers"
        :key="s"
        class="source-tab"
        :class="{ active: activeSeason === s }"
        @click="activeSeason = s"
      >Season {{ s }}</button>
    </div>

    <!-- Episode list (series only) -->
    <div v-if="isSeries && seasons[activeSeason]" class="episode-list-wrap">
      <h3 class="episode-section-title">Episodes — Season {{ activeSeason }}</h3>
      <div class="episode-list">
        <button
          v-for="ep in seasons[activeSeason]"
          :key="ep.id"
          class="episode-pill"
          :class="{ active: activeEpisodeId === ep.id }"
          @click="selectEpisode(ep)"
        >
          <span class="ep-num">E{{ ep.episode }}</span>
          <span class="ep-title">{{ ep.episode_title || 'Episode ' + ep.episode }}</span>
        </button>
      </div>
    </div>

  </div>

  <!-- Player section — full width, outside the max-width constraint -->
  <div v-if="movie" class="player-section">
    <!-- Russian source: direct iframe player -->
    <div v-if="isRussianSource">
      <IframePlayer :key="activeEpisodeId" :source-url="activeEpisode.source_url" :source-name="movie.source" :movie-id="activeEpisodeId" />
    </div>

    <!-- English sources: tabs for dual source -->
    <template v-else>
      <!-- Source Tabs -->
      <div class="source-tabs" v-if="hasBothSources">
        <button class="source-tab" :class="{ active: activeTab === '123movies' }" @click="activeTab = '123movies'">
          🌐 Watch Online
        </button>
        <button class="source-tab" :class="{ active: activeTab === 'torrent' }" @click="activeTab = 'torrent'">
          🧲 Torrent Stream
        </button>
      </div>

      <!-- 123Movies Iframe Player -->
      <div v-if="show123">
        <IframePlayer :source-url="activeEpisode.source_url" />
      </div>

      <!-- Torrent Player -->
      <div v-if="showTorrent">
        <TorrentPlayer :magnet="activeEpisode.torrent_magnet" :quality="activeEpisode.torrent_quality" :movie-id="activeEpisodeId" :is-offline="!!activeEpisode.offline_path" />
      </div>

      <!-- Single source -->
      <div v-if="!hasBothSources">
        <div v-if="activeEpisode.source_url && activeEpisode.source !== 'torrent'">
          <IframePlayer :source-url="activeEpisode.source_url" />
        </div>
        <TorrentPlayer v-else-if="activeEpisode.torrent_magnet" :magnet="activeEpisode.torrent_magnet" :quality="activeEpisode.torrent_quality" :movie-id="activeEpisodeId" :is-offline="!!activeEpisode.offline_path" />
        <div v-else class="empty-state">
          <p>No streaming source available</p>
        </div>
      </div>
    </template>
  </div>

  <div v-else class="content loading">Loading movie...</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import { useMoviesStore } from '../stores/movies.js';
import TorrentPlayer from '../components/TorrentPlayer.vue';
import IframePlayer from '../components/IframePlayer.vue';
import CriticScores from '../components/CriticScores.vue';

const moviesStore = useMoviesStore();

const route = useRoute();
const movie = ref(null);
const activeTab = ref('123movies');

// Series state
const seasons = ref({});
const activeSeason = ref(1);
const activeEpisodeId = ref(null);

const isSeries = computed(() => movie.value?.type === 'series');
const seasonNumbers = computed(() => Object.keys(seasons.value).map(Number).sort((a, b) => a - b));

// The currently active episode data (for torrent magnet etc.)
const activeEpisode = computed(() => {
  if (!isSeries.value) return movie.value || {};
  const eps = seasons.value[activeSeason.value] || [];
  return eps.find(e => e.id === activeEpisodeId.value) || movie.value || {};
});

onMounted(async () => {
  const { data } = await axios.get(`/api/movies/${route.params.id}`);
  movie.value = data;
  activeEpisodeId.value = data.id;

  // Mark as watched
  axios.patch(`/api/movies/${route.params.id}/watched`);

  // Default to available source
  if (data.source === 'torrent') activeTab.value = 'torrent';
  else if (['hdrezka', 'seazonvar', 'filmix'].includes(data.source)) activeTab.value = data.source;
  else activeTab.value = '123movies';

  // If series, fetch all episodes
  if (data.type === 'series') {
    try {
      const { data: epData } = await axios.get(`/api/movies/${route.params.id}/episodes`);
      seasons.value = epData.seasons;
      // Set active season to the season of the current episode
      activeSeason.value = data.season || seasonNumbers.value[0] || 1;
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
    }
  }
});

function selectEpisode(ep) {
  activeEpisodeId.value = ep.id;
  axios.patch(`/api/movies/${ep.id}/watched`);
}

const russianSources = ['hdrezka', 'seazonvar', 'filmix'];
const isRussianSource = computed(() => russianSources.includes(movie.value?.source));

const hasBothSources = computed(() => activeEpisode.value?.source === 'both');
const show123 = computed(() => hasBothSources.value && activeTab.value === '123movies');
const showTorrent = computed(() => hasBothSources.value && activeTab.value === 'torrent');

const sourceClass = computed(() => {
  const s = movie.value?.source;
  if (s === 'both') return 'sboth';
  if (s === 'torrent') return 'storrent';
  if (russianSources.includes(s)) return 'sru';
  return 's123';
});

const sourceLabelMap = {
  both: 'Both Sources',
  torrent: 'Torrent',
  '123movies': '123Movies',
  hdrezka: 'Hdrezka',
  seazonvar: 'Seazonvar',
  filmix: 'Filmix',
};

const sourceLabel = computed(() => {
  return sourceLabelMap[movie.value?.source] || movie.value?.source || '123Movies';
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
