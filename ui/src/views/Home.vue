<template>
  <div class="content">
    <FilterBar />

    <div v-if="store.loading && store.movies.length === 0" class="loading">Loading movies...</div>

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

      <div class="load-more-bar">
        <button
          v-if="store.page < store.pages"
          ref="loadMoreBtn"
          class="btn-load-more"
          :disabled="store.loadingMore"
          @click="store.fetchMoreMovies()"
        >
          {{ store.loadingMore ? 'Loading...' : 'Load More' }}
        </button>
        <div v-else-if="store.movies.length > 0" class="all-loaded">
          ✓ All {{ store.total }} movies loaded
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useMoviesStore } from '../stores/movies.js';
import MovieCard from '../components/MovieCard.vue';
import FilterBar from '../components/FilterBar.vue';

const store = useMoviesStore();
const loadMoreBtn = ref(null);
let observer = null;

function createObserver() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !store.loadingMore && store.page < store.pages) {
      store.fetchMoreMovies();
    }
  }, { rootMargin: '400px' });
}

// Auto-load when Load More button scrolls into view
watch(loadMoreBtn, (el) => {
  if (!observer) createObserver();
  if (el) observer.observe(el);
});

onMounted(() => {
  createObserver();
  if (store.movies.length === 0) store.fetchMovies(1);
});

onUnmounted(() => {
  if (observer) observer.disconnect();
});
</script>
