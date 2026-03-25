<template>
  <div id="watchflix">
    <header class="top-bar">
      <router-link to="/" class="logo">🎬 Watchflix</router-link>
      <div class="search-wrap">
        <input
          v-model="searchQuery"
          @keyup.enter="doSearch"
          type="text"
          placeholder="Search movies..."
          class="search-input"
        />
      </div>
      <nav class="nav-links">
        <router-link to="/" class="nav-link">Home</router-link>
        <router-link to="/favorites" class="nav-link">★ Favorites</router-link>
        <router-link to="/hidden" class="nav-link">🙈 Hidden</router-link>
        <button class="btn-scrape" @click="store.triggerScrape()" :disabled="store.scraping">
          {{ store.scraping ? '⏳ Scraping...' : '🔄 Update' }}
        </button>
      </nav>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMoviesStore } from './stores/movies.js';

const store = useMoviesStore();
const router = useRouter();
const searchQuery = ref('');

function doSearch() {
  store.filters.search = searchQuery.value;
  store.fetchMovies(1);
  router.push('/');
}
</script>
