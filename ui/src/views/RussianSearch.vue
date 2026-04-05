<template>
  <div class="content">
    <h2>Russian Source Search</h2>
    <p class="search-hint">Search across Hdrezka, Seazonvar, and Filmix</p>

    <div class="search-bar">
      <input
        v-model="query"
        @keyup.enter="doSearch"
        type="text"
        placeholder="Search in Russian sources..."
        class="search-input"
      />
      <button class="btn" @click="doSearch" :disabled="searching">
        {{ searching ? 'Searching...' : 'Search' }}
      </button>
    </div>

    <div v-if="searching" class="loading">Searching Russian sources...</div>

    <div v-if="!searching && results.length > 0" class="results-table-wrap">
      <table class="results-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Year</th>
            <th>Type</th>
            <th>Source</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.url">
            <td class="result-title">
              <img v-if="r.poster" :src="r.poster" class="result-poster" />
              <span>{{ r.title }}</span>
            </td>
            <td>{{ r.year || '-' }}</td>
            <td>{{ r.type === 'series' ? 'TV Series' : 'Movie' }}</td>
            <td>
              <span class="source-badge sru">{{ r.source }}</span>
            </td>
            <td>
              <router-link v-if="r.inLibrary" :to="`/movie/${r.libraryId}`" class="btn btn-sm">
                Watch
              </router-link>
              <button v-else class="btn btn-sm" @click="addToLibrary(r)" :disabled="r.adding">
                {{ r.adding ? 'Adding...' : '+ Add' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!searching && searched && results.length === 0" class="empty-state">
      <p>No results found</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import axios from 'axios';
import { useRouter } from 'vue-router';

const router = useRouter();
const query = ref('');
const results = ref([]);
const searching = ref(false);
const searched = ref(false);

async function doSearch() {
  if (!query.value.trim() || query.value.trim().length < 2) return;
  searching.value = true;
  searched.value = true;
  try {
    const { data } = await axios.get('/api/russian-search', { params: { q: query.value.trim() } });
    results.value = data.results.map(r => ({ ...r, adding: false }));
  } catch (err) {
    console.error('Russian search failed:', err);
    results.value = [];
  } finally {
    searching.value = false;
  }
}

async function addToLibrary(item) {
  item.adding = true;
  try {
    const { data } = await axios.post('/api/russian-search/add', {
      title: item.title,
      year: item.year,
      url: item.url,
      poster: item.poster,
      type: item.type,
      source: item.source,
    });
    item.inLibrary = true;
    item.libraryId = data.id;
  } catch (err) {
    console.error('Failed to add:', err);
  } finally {
    item.adding = false;
  }
}
</script>

<style scoped>
.search-hint {
  color: var(--text-muted);
  margin-bottom: 16px;
  font-size: 14px;
}
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}
.search-bar .search-input {
  flex: 1;
}
.results-table-wrap {
  overflow-x: auto;
}
.results-table {
  width: 100%;
  border-collapse: collapse;
}
.results-table th,
.results-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.results-table th {
  color: var(--text-dim);
  font-weight: 600;
  font-size: 13px;
}
.result-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.result-poster {
  width: 36px;
  height: 52px;
  object-fit: cover;
  border-radius: 3px;
}
.source-badge.sru {
  background: #e53935;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
}
.btn-sm {
  font-size: 13px;
  padding: 4px 12px;
}
</style>
