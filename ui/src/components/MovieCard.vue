<template>
  <div class="movie-card" @click="$router.push(`/movie/${movie.id}`)">
    <button
      class="fav-btn"
      :class="{ active: movie.is_favorite }"
      @click.stop="$emit('toggle-fav', movie.id)"
    >{{ movie.is_favorite ? '★' : '☆' }}</button>
    <button
      class="hide-btn"
      @click.stop="$emit('hide', movie.id)"
      title="Hide movie"
    >✕</button>
    <img
      class="poster"
      :src="movie.poster || '/placeholder.svg'"
      :alt="movie.title"
      loading="lazy"
      @error="$event.target.src='/placeholder.svg'"
    />
    <div class="overlay">
      <div class="card-play"></div>
      <div class="card-title">{{ movie.title }}</div>
      <div class="card-meta">
        <span v-if="movie.year">{{ movie.year }}</span>
        <span class="rating-badge" :class="ratingClass">
          ⭐ {{ movie.imdb_rating || 'N/A' }}
        </span>
        <span class="source-badge" :class="sourceClass">{{ sourceLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ movie: Object });
defineEmits(['toggle-fav', 'hide']);

const ratingClass = computed(() => {
  const r = props.movie.imdb_rating;
  if (!r) return '';
  if (r >= 7) return 'good';
  if (r >= 5) return 'mid';
  return 'bad';
});

const sourceClass = computed(() => {
  const s = props.movie.source;
  if (s === 'both') return 'sboth';
  if (s === 'torrent') return 'storrent';
  return 's123';
});

const sourceLabel = computed(() => {
  const s = props.movie.source;
  if (s === 'both') return 'Both';
  if (s === 'torrent') return 'Torrent';
  return '123M';
});
</script>
