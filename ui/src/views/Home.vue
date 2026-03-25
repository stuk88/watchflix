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

      <div class="load-more-bar">
        <button
          v-if="store.page < store.pages"
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
import { onMounted } from 'vue';
import { useMoviesStore } from '../stores/movies.js';
import MovieCard from '../components/MovieCard.vue';
import FilterBar from '../components/FilterBar.vue';

const store = useMoviesStore();

onMounted(() => {
  if (store.movies.length === 0) store.fetchMovies(1);
});
</script>
