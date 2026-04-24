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
      <div class="card-title">{{ movie.title_en || movie.title }}</div>
      <div v-if="movie.title_en && movie.title_en !== movie.title" class="card-title-ru">{{ movie.title }}</div>
      <div class="card-meta">
        <span v-if="firstGenre" class="genre-badge">{{ firstGenre }}</span>
        <span v-if="movie.year">{{ movie.year }}</span>
        <span v-if="movie.type === 'series'" class="series-badge">
          📺 {{ seasonLabel }}
        </span>
        <span v-else class="rating-badge" :class="ratingClass">
          {{ ratingIcon }} {{ ratingDisplay }}
        </span>
        <span class="source-badge" :class="sourceClass">{{ sourceLabel }}</span>
        <span v-if="movie.offline_path" class="offline-badge">💾</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useMoviesStore } from '../stores/movies.js';

const props = defineProps({ movie: Object, canUnhide: Boolean });
defineEmits(['toggle-fav', 'hide', 'unhide']);

const store = useMoviesStore();

const firstGenre = computed(() => props.movie.genre?.split(',')[0]?.trim() || null);

const ratingValue = computed(() => {
  const p = store.ratingProvider;
  if (p === 'rt') return props.movie.rt_rating ? parseInt(props.movie.rt_rating) : null;
  if (p === 'meta') return props.movie.meta_rating ?? null;
  return props.movie.imdb_rating ?? null;
});

const ratingDisplay = computed(() => {
  const v = ratingValue.value;
  if (v == null) return 'N/A';
  if (store.ratingProvider === 'rt') return v + '%';
  return v;
});

const ratingIcon = computed(() => {
  const p = store.ratingProvider;
  if (p === 'rt') return '🍅';
  if (p === 'meta') return 'M';
  return '⭐';
});

const ratingClass = computed(() => {
  const v = ratingValue.value;
  if (v == null) return '';
  const normalized = store.ratingProvider === 'imdb' ? v * 10 : v;
  if (normalized >= 70) return 'good';
  if (normalized >= 50) return 'mid';
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
