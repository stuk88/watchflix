<template>
  <div class="content">
    <h2 style="margin-bottom: 24px; font-weight: 700; color: #f5c518;">★ Favorites</h2>

    <div v-if="loading" class="loading">Loading favorites...</div>

    <div v-else-if="movies.length === 0" class="empty-state">
      <div class="emoji">⭐</div>
      <p>No favorites yet. Click the star on any movie to save it!</p>
    </div>

    <div v-else class="movie-grid">
      <MovieCard
        v-for="movie in movies"
        :key="movie.id"
        :movie="movie"
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
  const { data } = await axios.get('/api/movies', { params: { favorites: '1', limit: 100 } });
  movies.value = data.movies;
  loading.value = false;
});

async function toggleFav(id) {
  await axios.patch(`/api/movies/${id}/favorite`);
  movies.value = movies.value.filter(m => m.id !== id);
}
</script>
