<template>
  <div class="critic-scores">
    <!-- Loading -->
    <div v-if="loading" class="critic-card">
      <h3 class="critic-heading">Critic Analysis</h3>
      <div class="critic-loading">
        <div class="critic-spinner"></div>
        Analyzing reviews...
      </div>
    </div>

    <!-- No results -->
    <div v-else-if="scores.length === 0" class="critic-card critic-empty">
      <h3 class="critic-heading">Critic Analysis</h3>
      <p>No professional reviews found</p>
    </div>

    <!-- Combined score + individual reviews -->
    <template v-else>
      <div class="critic-card critic-combined">
        <div class="critic-header">
          <div>
            <h3 class="critic-heading">Combined Score</h3>
            <span class="critic-count">Based on {{ scores.length }} reviews</span>
          </div>
          <div class="critic-big-score">{{ combined.weighted.toFixed(1) }}</div>
        </div>
        <div class="critic-bars">
          <div v-for="cat in categories" :key="cat.key" class="critic-bar-row">
            <div class="critic-bar-meta">
              <span class="critic-bar-label">{{ cat.label }}</span>
              <span class="critic-bar-val">{{ combined.scores[cat.key].toFixed(1) }}</span>
            </div>
            <div class="critic-bar-track">
              <div class="critic-bar-fill" :style="{ width: (combined.scores[cat.key] / 10 * 100) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="critic-reviews">
        <h3 class="critic-heading">Individual Reviews ({{ scores.length }})</h3>
        <div class="critic-review-list">
          <div
            v-for="critic in sortedScores"
            :key="critic.source"
            class="critic-review"
          >
            <button class="critic-review-header" @click="toggle(critic.source)">
              <div class="critic-review-left">
                <span class="critic-review-score">{{ medianOf(critic).toFixed(1) }}</span>
                <div class="critic-review-info">
                  <div class="critic-review-source">{{ critic.source }}</div>
                  <div v-if="critic.summary" class="critic-review-summary">{{ critic.summary }}</div>
                </div>
              </div>
              <span class="critic-review-chevron">{{ expanded === critic.source ? '▲' : '▼' }}</span>
            </button>
            <div v-if="expanded === critic.source" class="critic-review-detail">
              <div v-for="cat in categories" :key="cat.key" class="critic-detail-row">
                <div class="critic-detail-meta">
                  <span>{{ cat.label }}</span>
                  <span class="critic-detail-val">{{ critic.scores[cat.key] || 0 }}</span>
                </div>
                <div class="critic-detail-track">
                  <div class="critic-detail-fill" :style="{ width: ((critic.scores[cat.key] || 0) / 10 * 100) + '%' }"></div>
                </div>
              </div>
              <a :href="critic.url" target="_blank" rel="noopener noreferrer" class="critic-review-link">
                Read full review →
              </a>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';

const props = defineProps({
  movieId: [String, Number],
});

const categories = [
  { key: 'story', label: 'Story / Screenplay', weight: 0.20 },
  { key: 'acting', label: 'Acting', weight: 0.15 },
  { key: 'direction', label: 'Direction', weight: 0.15 },
  { key: 'cinematography', label: 'Cinematography', weight: 0.15 },
  { key: 'productionDesign', label: 'Production Design', weight: 0.10 },
  { key: 'editing', label: 'Editing', weight: 0.10 },
  { key: 'sound', label: 'Sound / Music', weight: 0.05 },
  { key: 'emotionalImpact', label: 'Emotional Impact', weight: 0.10 },
];

const loading = ref(true);
const scores = ref([]);
const expanded = ref(null);

function median(vals) {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOf(critic) {
  return median(categories.map(c => critic.scores[c.key] || 0));
}

const combined = computed(() => {
  if (scores.value.length === 0) return null;
  const med = {};
  for (const cat of categories) {
    med[cat.key] = Math.round(
      median(scores.value.map(s => s.scores[cat.key] || 0)) * 10
    ) / 10;
  }
  let weighted = 0;
  for (const cat of categories) weighted += cat.weight * (med[cat.key] || 0);
  return { scores: med, weighted: Math.round(weighted * 100) / 100 };
});

const sortedScores = computed(() => {
  return [...scores.value].sort((a, b) => medianOf(b) - medianOf(a));
});

function toggle(source) {
  expanded.value = expanded.value === source ? null : source;
}

onMounted(async () => {
  try {
    const { data } = await axios.get(`/api/movies/${props.movieId}/critic-scores`);
    scores.value = data.criticScores || [];
  } catch {
    // silent
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.critic-scores {
  margin-top: 16px;
}
.critic-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 20px;
}
.critic-combined {
  border-color: rgba(119,190,65,0.25);
}
.critic-heading {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}
.critic-count {
  font-size: 12px;
  color: var(--text-muted);
}
.critic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.critic-big-score {
  font-size: 36px;
  font-weight: 700;
  color: var(--accent, #77be41);
  line-height: 1;
}
.critic-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.critic-bar-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.critic-bar-meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.critic-bar-label {
  color: var(--text-muted);
}
.critic-bar-val {
  font-variant-numeric: tabular-nums;
  color: var(--accent, #77be41);
}
.critic-bar-track {
  height: 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  overflow: hidden;
}
.critic-bar-fill {
  height: 100%;
  background: var(--accent, #77be41);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.critic-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}
.critic-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: critic-spin 0.7s linear infinite;
}
@keyframes critic-spin { to { transform: rotate(360deg); } }
.critic-empty p {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}
.critic-reviews {
  margin-top: 16px;
}
.critic-review-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.critic-review {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  overflow: hidden;
}
.critic-review-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.critic-review-header:hover {
  background: rgba(255,255,255,0.04);
}
.critic-review-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.critic-review-score {
  font-size: 17px;
  font-weight: 700;
  color: var(--accent, #77be41);
  width: 36px;
  flex-shrink: 0;
  text-align: center;
}
.critic-review-info {
  min-width: 0;
}
.critic-review-source {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.critic-review-summary {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}
.critic-review-chevron {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 8px;
}
.critic-review-detail {
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.critic-detail-row {
  margin-bottom: 6px;
}
.critic-detail-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}
.critic-detail-val {
  color: var(--accent, #77be41);
  font-variant-numeric: tabular-nums;
}
.critic-detail-track {
  height: 4px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
}
.critic-detail-fill {
  height: 100%;
  background: rgba(119,190,65,0.6);
  border-radius: 2px;
  transition: width 0.3s ease;
}
.critic-review-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--accent, #77be41);
  text-decoration: none;
}
.critic-review-link:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .critic-card { padding: 14px; }
  .critic-big-score { font-size: 28px; }
  .critic-heading { font-size: 14px; }
  .critic-bar-meta { font-size: 12px; }
  .critic-review-header { padding: 8px 10px; }
  .critic-review-score { font-size: 15px; width: 30px; }
  .critic-review-source { font-size: 12px; }
  .critic-review-summary { max-width: 200px; font-size: 10px; }
  .critic-review-detail { padding: 8px 10px 12px; }
}
</style>
