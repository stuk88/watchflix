<template>
  <div class="content">
    <div class="ts-header">
      <h2 class="ts-title">Torrent Search</h2>
      <p class="ts-subtitle">Search torrent sites for healthy torrents (5+ seeders)</p>
    </div>

    <form class="ts-search-bar" @submit.prevent="doSearch">
      <input
        v-model="query"
        type="text"
        placeholder="Search for a movie or show..."
        class="ts-search-input"
        autofocus
      />
      <button type="submit" class="btn btn-primary" :disabled="searching">
        {{ searching ? 'Searching...' : 'Search' }}
      </button>
    </form>

    <div v-if="searching" class="loading">Searching torrent sites...</div>

    <div v-else-if="searched && results.length === 0" class="empty-state">
      <p>No healthy torrents found for "{{ lastQuery }}"</p>
    </div>

    <div v-else-if="results.length > 0" class="ts-results">
      <div class="ts-results-count">{{ results.length }} results for "{{ lastQuery }}"</div>

      <div class="ts-table-wrap">
        <table class="ts-table">
          <thead>
            <tr>
              <th class="col-name">Name</th>
              <th class="col-quality">Quality</th>
              <th class="col-size">Size</th>
              <th class="col-seeds">Seeds</th>
              <th class="col-source">Source</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in results" :key="r.infohash" class="ts-row">
              <td class="col-name">
                <div class="ts-name-wrap">
                  <img v-if="r.poster" :src="r.poster" class="ts-poster" alt="" />
                  <div>
                    <div class="ts-name">{{ r.name }}</div>
                    <div v-if="r.rating" class="ts-meta">
                      <span :class="['rating-badge', ratingClass(r.rating)]">{{ r.rating }}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="col-quality">
                <span :class="['quality-badge', `q-${r.quality.toLowerCase()}`]">{{ r.quality }}</span>
              </td>
              <td class="col-size">{{ r.size }}</td>
              <td class="col-seeds">
                <span class="seeds-count">{{ r.seeds }}</span>
              </td>
              <td class="col-source">
                <span class="source-tag">{{ r.source }}</span>
              </td>
              <td class="col-action">
                <button
                  v-if="added[r.infohash]"
                  class="btn btn-outline btn-sm"
                  @click="goToMovie(added[r.infohash])"
                >
                  Watch
                </button>
                <button
                  v-else
                  class="btn btn-primary btn-sm"
                  :disabled="adding[r.infohash]"
                  @click="addToLibrary(r)"
                >
                  {{ adding[r.infohash] ? 'Adding...' : '+ Library' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';

const router = useRouter();

const query = ref('');
const lastQuery = ref('');
const results = ref([]);
const searching = ref(false);
const searched = ref(false);
const adding = reactive({});
const added = reactive({});

async function doSearch() {
  const q = query.value.trim();
  if (!q) return;

  searching.value = true;
  searched.value = false;
  results.value = [];
  lastQuery.value = q;

  try {
    const { data } = await axios.get('/api/torrent-search', { params: { q } });
    results.value = data.results || [];
  } catch (err) {
    console.error('Torrent search failed:', err);
  } finally {
    searching.value = false;
    searched.value = true;
  }
}

async function addToLibrary(r) {
  adding[r.infohash] = true;
  try {
    const { data } = await axios.post('/api/torrent-search/add', {
      magnet: r.magnet,
      name: r.name,
      quality: r.quality,
      infohash: r.infohash,
    });
    if (data.ok) {
      added[r.infohash] = data.movieId;
    }
  } catch (err) {
    console.error('Failed to add torrent:', err);
  } finally {
    adding[r.infohash] = false;
  }
}

function goToMovie(movieId) {
  router.push(`/movie/${movieId}`);
}

function ratingClass(rating) {
  if (rating >= 7) return 'good';
  if (rating >= 5) return 'mid';
  return 'bad';
}
</script>

<style scoped>
.ts-header {
  margin-bottom: 24px;
}

.ts-title {
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 4px;
}

.ts-subtitle {
  font-size: 14px;
  color: var(--text-dim);
}

.ts-search-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.ts-search-input {
  flex: 1;
  padding: 12px 18px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: var(--bg-surface);
  color: var(--text);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}
.ts-search-input:focus {
  border-color: var(--accent);
}
.ts-search-input::placeholder {
  color: var(--text-muted);
}

.ts-results-count {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 12px;
}

.ts-table-wrap {
  overflow-x: auto;
}

.ts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.ts-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.ts-table td {
  padding: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  vertical-align: middle;
}

.ts-row:hover {
  background: var(--bg-hover);
}

.ts-name-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ts-poster {
  width: 36px;
  height: 54px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.ts-name {
  font-weight: 500;
  line-height: 1.3;
  word-break: break-word;
}

.ts-meta {
  margin-top: 4px;
}

.col-quality, .col-size, .col-seeds, .col-source, .col-action {
  white-space: nowrap;
  text-align: center;
}

.col-name {
  min-width: 300px;
}

.quality-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
}
.q-4k { background: rgba(255,215,0,0.15); color: gold; }
.q-1080p { background: rgba(100,149,237,0.2); color: cornflowerblue; }
.q-720p { background: rgba(119,190,65,0.2); color: var(--accent); }
.q-480p { background: rgba(255,152,0,0.2); color: var(--mid); }
.q-unknown { background: rgba(255,255,255,0.06); color: var(--text-dim); }

.seeds-count {
  color: var(--good);
  font-weight: 700;
}

.source-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  color: var(--text-dim);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 12px;
  border-radius: 14px;
}

@media (max-width: 768px) {
  .ts-search-bar {
    flex-direction: column;
  }

  .col-name {
    min-width: 200px;
  }

  .ts-poster {
    display: none;
  }
}
</style>
