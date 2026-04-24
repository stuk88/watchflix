<template>
  <div class="filter-bar">
    <label>
      Language
      <select v-model="store.filters.language" @change="onLanguageChange">
        <option value="all">All Languages</option>
        <option value="en">English</option>
        <option value="ru">Russian</option>
      </select>
    </label>
    <label>
      Type
      <select v-model="store.filters.type" @change="apply">
        <option value="all">All Types</option>
        <option value="movie">Movies</option>
        <option value="series">TV Series</option>
      </select>
    </label>
    <label>
      Genre
      <select v-model="store.filters.genre" @change="apply">
        <option value="">All</option>
        <option v-for="g in genres" :key="g" :value="g">{{ g }}</option>
      </select>
    </label>
    <label>
      Country
      <select v-model="store.filters.country" @change="apply">
        <option value="">All</option>
        <option v-for="c in countries" :key="c" :value="c">{{ c }}</option>
      </select>
    </label>
    <label>
      Rating
      <select :value="store.ratingProvider" @change="onProviderChange($event.target.value)">
        <option value="imdb">IMDb</option>
        <option value="rt">Rotten Tomatoes</option>
        <option value="meta">Metascore</option>
      </select>
    </label>
    <label>
      Sort
      <select v-model="store.filters.sort" @change="apply">
        <option value="added_at">Recently Added</option>
        <option value="rating">{{ providerLabel }} Rating</option>
        <option value="year">Year</option>
        <option value="title">Title</option>
      </select>
    </label>
    <label>
      Order
      <select v-model="store.filters.order" @change="apply">
        <option value="desc">↓ Descending</option>
        <option value="asc">↑ Ascending</option>
      </select>
    </label>
    <label>
      Source
      <select v-model="store.filters.source" @change="apply">
        <option value="all">All Sources</option>
        <template v-if="store.filters.language === 'ru'">
          <option value="hdrezka">Hdrezka</option>
          <option value="seazonvar">Seazonvar</option>
          <option value="filmix">Filmix</option>
        </template>
        <template v-else>
          <option value="123movies">123Movies</option>
          <option value="torrent">Torrents</option>
        </template>
      </select>
    </label>
    <label>
      Min {{ providerLabel }} {{ store.filters.min_rating }}{{ store.ratingProvider === 'rt' ? '%' : '' }}
      <input type="range" :min="ratingRange.min" :max="ratingRange.max" :step="ratingRange.step" v-model.number="store.filters.min_rating" @change="apply" />
    </label>
    <span class="filter-stats">{{ store.total }} movies</span>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue';
import axios from 'axios';
import { useMoviesStore } from '../stores/movies.js';

const store = useMoviesStore();
const countries = ref([]);

onMounted(async () => {
  try {
    const { data } = await axios.get('/api/movies/countries');
    countries.value = data.countries;
  } catch (e) {
    console.error('Failed to load countries:', e);
  }
});

const genres = [
  'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'Film-Noir', 'Game-Show',
  'History', 'Horror', 'Music', 'Musical', 'Mystery', 'News', 'Reality-TV',
  'Romance', 'Sci-Fi', 'Short', 'Sport', 'Talk-Show', 'Thriller', 'War', 'Western'
];

const providerLabels = { imdb: 'IMDb', rt: 'RT', meta: 'Meta' };
const providerLabel = computed(() => providerLabels[store.ratingProvider] || 'IMDb');

const ratingRange = computed(() => {
  if (store.ratingProvider === 'imdb') return { min: 0, max: 10, step: 0.5 };
  return { min: 0, max: 100, step: 5 };
});

function onProviderChange(provider) {
  store.setRatingProvider(provider);
  apply();
}

function onLanguageChange() {
  store.filters.source = 'all';
  apply();
}

function apply() {
  store.fetchMovies(1);
}
</script>
