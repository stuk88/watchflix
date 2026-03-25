<template>
  <div class="content">
    <h2 style="margin-bottom: 24px; font-weight: 700; color: #aaa;">🙈 Hidden Movies</h2>

    <div v-if="loading" class="loading">Loading hidden movies...</div>

    <div v-else-if="movies.length === 0" class="empty-state">
      <div class="emoji">👁️</div>
      <p>No hidden movies. Use ✕ on any movie to hide it.</p>
    </div>

    <div v-else class="movie-grid">
      <MovieCard
        v-for="movie in movies"
        :key="movie.id"
        :movie="movie"
        :can-unhide="true"
        @unhide="unhide(movie.id)"
        @toggle-fav="toggleFav(movie.id)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import MovieCard from '../components/MovieCard.vue';

const movies = ref([]);
const loading = ref(true);

onMounted(async () => {
  const { data } = await axios.get('/api/movies', { params: { only_hidden: '1', limit: 200 } });
  movies.value = data.movies;
  loading.value = false;
});

async function unhide(id) {
  await axios.patch(`/api/movies/${id}/hide`);
  movies.value = movies.value.filter(m => m.id !== id);
}

async function toggleFav(id) {
  await axios.patch(`/api/movies/${id}/favorite`);
  const movie = movies.value.find(m => m.id === id);
  if (movie) movie.is_favorite = movie.is_favorite ? 0 : 1;
}
</script>
