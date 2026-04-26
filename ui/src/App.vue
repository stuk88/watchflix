<template>
  <div id="watchflix">
    <header class="top-bar">
      <router-link to="/" class="logo">🎬 Watchflix</router-link>
      <div class="search-wrap">
        <input
          v-model="searchQuery"
          @input="debouncedSearch"
          @keyup.enter="doSearch"
          type="text"
          placeholder="Search movies..."
          class="search-input"
        />
      </div>
      <button class="menu-toggle" @click="menuOpen = !menuOpen" aria-label="Menu">
        <span :class="{ open: menuOpen }">☰</span>
      </button>
      <nav class="nav-links" :class="{ open: menuOpen }">
        <router-link to="/" class="nav-link" @click="menuOpen = false">Home</router-link>
        <router-link to="/favorites" class="nav-link" @click="menuOpen = false">★ Favorites</router-link>
        <router-link to="/hidden" class="nav-link" @click="menuOpen = false">🙈 Hidden</router-link>
        <router-link to="/torrent-search" class="nav-link" @click="menuOpen = false">Torrent Search</router-link>
        <router-link to="/russian-search" class="nav-link" @click="menuOpen = false">🇷🇺 RU Search</router-link>
        <button class="btn-scrape" @click="store.triggerScrape(); menuOpen = false" :disabled="store.scraping">
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
const menuOpen = ref(false);
let searchTimer = null;

function doSearch() {
  store.filters.search = searchQuery.value;
  store.fetchMovies(1);
  router.push('/');
}

function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 300);
}
</script>
