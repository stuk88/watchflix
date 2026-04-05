<template>
  <div class="movie-card" @click="$router.push(`/movie/${movie.id}`)">
    <button
      class="fav-btn"
      :class="{ active: movie.is_favorite }"
      @click.stop="$emit('toggle-fav', movie.id)"
    >{{ movie.is_favorite ? '★' : '☆' }}</button>
    <button
      class="hide-btn"
      @click.stop="canUnhide ? $emit('unhide', movie.id) : $emit('hide', movie.id)"
      :title="canUnhide ? 'Unhide movie' : 'Hide movie'"
    >{{ canUnhide ? '↩' : '✕' }}</button>
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
        <span v-if="firstGenre" class="genre-badge">{{ firstGenre }}</span>
        <span v-if="movie.year">{{ movie.year }}</span>
        <span v-if="movie.type === 'series'" class="series-badge">
          📺 {{ seasonLabel }}
        </span>
        <span v-else class="rating-badge" :class="ratingClass">
          ⭐ {{ movie.imdb_rating || 'N/A' }}
        </span>
        <span class="source-badge" :class="sourceClass">{{ sourceLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ movie: Object, canUnhide: Boolean });
defineEmits(['toggle-fav', 'hide', 'unhide']);

const firstGenre = computed(() => props.movie.genre?.split(',')[0]?.trim() || null);

const ratingClass = computed(() => {
  const r = props.movie.imdb_rating;
  if (!r) return '';
  if (r >= 7) return 'good';
  if (r >= 5) return 'mid';
  return 'bad';
});

const seasonLabel = computed(() => {
  const count = props.movie.episode_count;
  if (!count) return 'TV Series';
  const s = props.movie.season;
  return s ? `S${s} • ${count} ep` : `${count} episodes`;
});

const russianSources = ['hdrezka', 'seazonvar', 'filmix'];

const sourceClass = computed(() => {
  const s = props.movie.source;
  if (s === 'both') return 'sboth';
  if (s === 'torrent') return 'storrent';
  if (russianSources.includes(s)) return 'sru';
  return 's123';
});

const sourceLabelMap = {
  both: 'Both',
  torrent: 'Torrent',
  '123movies': '123M',
  hdrezka: 'HDR',
  seazonvar: 'SZV',
  filmix: 'FLX',
};

const sourceLabel = computed(() => {
  return sourceLabelMap[props.movie.source] || props.movie.source || '123M';
});
</script>
