import { defineStore } from 'pinia';
import axios from 'axios';

export const useMoviesStore = defineStore('movies', {
  state: () => ({
    movies: [],
    total: 0,
    page: 1,
    pages: 0,
    loading: false,
    scraping: false,
    filters: {
      sort: 'added_at',
      order: 'desc',
      genre: '',
      source: 'all',
      min_rating: 6,
      search: '',
      type: 'all',
    },
  }),

  actions: {
    async fetchMovies(page = 1) {
      this.loading = true;
      try {
        const params = { page, limit: 40, ...this.filters };
        if (!params.genre) delete params.genre;
        if (params.source === 'all') delete params.source;
        if (params.type === 'all') delete params.type;
        const { data } = await axios.get('/api/movies', { params });
        this.movies = data.movies;
        this.total = data.total;
        this.page = data.page;
        this.pages = data.pages;
      } catch (err) {
        console.error('Failed to fetch movies:', err);
      } finally {
        this.loading = false;
      }
    },

    async toggleFavorite(id) {
      try {
        const { data } = await axios.patch(`/api/movies/${id}/favorite`);
        const movie = this.movies.find(m => m.id === id);
        if (movie) movie.is_favorite = data.is_favorite;
        return data;
      } catch (err) {
        console.error('Failed to toggle favorite:', err);
      }
    },

    async hideMovie(id) {
      try {
        await axios.patch(`/api/movies/${id}/hide`);
        this.movies = this.movies.filter(m => m.id !== id);
        this.total--;
      } catch (err) {
        console.error('Failed to hide movie:', err);
      }
    },

    async triggerScrape() {
      this.scraping = true;
      try {
        await axios.post('/api/scrape/all');
        await this.fetchMovies(1);
      } catch (err) {
        console.error('Scrape failed:', err);
      } finally {
        this.scraping = false;
      }
    },
  },
});
