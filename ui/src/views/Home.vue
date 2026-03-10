<template>
  <div>
    <FilterBar />

    <div v-if="store.loading" class="loading">Loading movies...</div>

    <div v-else-if="store.initialized && store.movies.length === 0" class="empty-state">
      <div class="emoji">🎬</div>
      <p>No movies yet. Click <strong>🔄 Update</strong> to scrape movies!</p>
    </div>

    <template v-else>
      <div class="movie-grid">
        <MovieCard
          v-for="movie in store.movies"
          :key="movie.id"
          :movie="movie"
          @toggle-fav="store.toggleFavorite($event)"
          @hide="store.hideMovie($event)"
        />
      </div>

      <div class="pagination" v-if="store.pages > 1">
        <button class="page-btn" :disabled="store.page <= 1" @click="goPage(store.page - 1)">← Prev</button>
        <button
          v-for="p in visiblePages"
          :key="p"
          class="page-btn"
          :class="{ active: p === store.page }"
          @click="goPage(p)"
        >{{ p }}</button>
        <button class="page-btn" :disabled="store.page >= store.pages" @click="goPage(store.page + 1)">Next →</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useMoviesStore } from '../stores/movies.js';
import MovieCard from '../components/MovieCard.vue';
import FilterBar from '../components/FilterBar.vue';

const store = useMoviesStore();

onMounted(() => {
  if (store.movies.length === 0) store.fetchMovies(1);
});

function goPage(p) {
  store.fetchMovies(p);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const visiblePages = computed(() => {
  const pages = [];
  const start = Math.max(1, store.page - 3);
  const end = Math.min(store.pages, store.page + 3);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});
</script>
