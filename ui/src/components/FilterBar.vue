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
      Sort
      <select v-model="store.filters.sort" @change="apply">
        <option value="added_at">Recently Added</option>
        <option value="imdb_rating">IMDb Rating</option>
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
      Min ⭐ {{ store.filters.min_rating }}
      <input type="range" min="0" max="10" step="0.5" v-model.number="store.filters.min_rating" @change="apply" />
    </label>
    <span class="filter-stats">{{ store.total }} movies</span>
  </div>
</template>

<script setup>
import { useMoviesStore } from '../stores/movies.js';

const store = useMoviesStore();

const genres = [
  'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
  'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'
];

function onLanguageChange() {
  // Reset source filter when language changes (sources differ per language)
  store.filters.source = 'all';
  apply();
}

function apply() {
  store.fetchMovies(1);
}
</script>
