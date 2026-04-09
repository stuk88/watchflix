<template>
  <div class="content">
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

      <div class="load-more-bar" ref="loadMoreEl">
        <div v-if="store.page < store.pages" class="load-more-trigger">
          {{ store.loadingMore ? 'Loading...' : '' }}
        </div>
        <div v-else-if="store.movies.length > 0" class="all-loaded">
          ✓ All {{ store.total }} movies loaded
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useMoviesStore } from '../stores/movies.js';
import MovieCard from '../components/MovieCard.vue';
import FilterBar from '../components/FilterBar.vue';

const store = useMoviesStore();
const loadMoreEl = ref(null);
let observer = null;

onMounted(() => {
  if (store.movies.length === 0) store.fetchMovies(1);

  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !store.loadingMore && store.page < store.pages) {
      store.fetchMoreMovies();
    }
  }, { rootMargin: '200px' });

  // Watch for the element to appear
  const check = setInterval(() => {
    if (loadMoreEl.value) {
      observer.observe(loadMoreEl.value);
      clearInterval(check);
    }
  }, 200);
});

onUnmounted(() => {
  if (observer) observer.disconnect();
});
</script>
