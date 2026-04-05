import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue') },
  { path: '/movie/:id', name: 'movie', component: () => import('./views/Movie.vue') },
  { path: '/favorites', name: 'favorites', component: () => import('./views/Favorites.vue') },
  { path: '/hidden', name: 'hidden', component: () => import('./views/Hidden.vue') },
  { path: '/torrent-search', name: 'torrent-search', component: () => import('./views/TorrentSearch.vue') },
  { path: '/russian-search', name: 'russian-search', component: () => import('./views/RussianSearch.vue') },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
