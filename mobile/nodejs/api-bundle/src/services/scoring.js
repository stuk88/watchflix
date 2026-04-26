export const CATEGORIES = [
  { key: 'story', label: 'Story / Screenplay', weight: 0.20 },
  { key: 'acting', label: 'Acting', weight: 0.15 },
  { key: 'direction', label: 'Direction', weight: 0.15 },
  { key: 'cinematography', label: 'Cinematography', weight: 0.15 },
  { key: 'productionDesign', label: 'Production Design', weight: 0.10 },
  { key: 'editing', label: 'Editing', weight: 0.10 },
  { key: 'sound', label: 'Sound / Music', weight: 0.05 },
  { key: 'emotionalImpact', label: 'Emotional Impact', weight: 0.10 },
];

export function computeWeightedScore(scores) {
  let total = 0;
  for (const cat of CATEGORIES) {
    total += cat.weight * (scores[cat.key] || 0);
  }
  return Math.round(total * 100) / 100;
}

export function medianOf(vals) {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
