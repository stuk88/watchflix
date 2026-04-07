<template>
  <div class="iframe-player">
    <div v-if="!started" class="player-start" @click="startPlayer">
      <div class="start-icon">{{ icon }}</div>
      <div class="start-text">{{ label }}</div>
      <div class="start-quality">{{ qualityLabel }}</div>
    </div>
    <div v-else class="iframe-wrap">
      <webview
        v-if="useWebview"
        ref="webviewEl"
        :src="sourceUrl"
        class="player-webview"
        allowpopups="false"
        disablewebsecurity
      ></webview>
      <iframe
        v-else
        ref="iframeEl"
        :src="sourceUrl"
        class="player-iframe"
        allowfullscreen
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        frameborder="0"
      ></iframe>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';

const props = defineProps({
  sourceUrl: String,
  sourceName: { type: String, default: '123movies' },
});

const started = ref(false);
const iframeEl = ref(null);
const webviewEl = ref(null);

const sourceLabels = {
  '123movies': { icon: '🌐', label: 'Watch Online', quality: '123movies · HD' },
  hdrezka: { icon: '🎬', label: 'Hdrezka', quality: 'Hdrezka · HD' },
  seazonvar: { icon: '📺', label: 'Seazonvar', quality: 'Seazonvar · HD' },
  filmix: { icon: '🎥', label: 'Filmix', quality: 'Filmix · HD' },
};

const russianSources = ['hdrezka', 'seazonvar', 'filmix'];
const useWebview = computed(() => russianSources.includes(props.sourceName));

const info = computed(() => sourceLabels[props.sourceName] || sourceLabels['123movies']);
const icon = computed(() => info.value.icon);
const label = computed(() => info.value.label);
const qualityLabel = computed(() => info.value.quality);

// CSS to strip everything except player + episode selectors
const PLAYER_ONLY_CSS = {
  hdrezka: `
    header, footer, .b-header, .b-footer, .b-wrapper__sidebar, .b-sidetop, .b-sidelist,
    .b-post__rating_and, .b-post__infotable, .b-post__description, .b-post__social,
    .b-post__actions, .b-post__mixtures, .b-post__schedule, .b-post__franchise_list_item,
    .b-post__support, .b-content__htitle, .b-ads, .b-post__info, .b-post__lastepisodeout,
    ol.breadcrumb, .comments-tree-list, .b-content__bubble_rating,
    .b-post__rating, .b-post__origtitle, .b-post__title { display: none !important; }
    html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }
    .b-content__main, .b-wrapper, .b-container { max-width: 100% !important; padding: 0 !important; width: 100% !important; margin: 0 !important; }
    #cdnplayer, .b-player, #cdnplayer-container, .b-player__iframe_container, .b-player iframe {
      width: 100% !important; max-width: 100% !important; height: 70vh !important;
    }
    .b-simple_season__list, .b-simple_episodes__list, .b-translators__list {
      display: flex !important; flex-wrap: wrap !important; gap: 4px !important; padding: 8px !important; background: #111 !important;
    }
    .b-simple_season__list li, .b-simple_episodes__list li, .b-translators__list li {
      padding: 4px 10px !important; border-radius: 4px !important; background: #222 !important; color: #ccc !important; cursor: pointer !important; font-size: 13px !important;
    }
    .b-simple_season__list li.active, .b-simple_episodes__list li.active, .b-translators__list li.active {
      background: #4a6cf7 !important; color: #fff !important;
    }
  `,
  filmix: `
    header, footer, nav, .sidebar, .comments, .related, .breadcrumbs,
    .full-story-line, .full-story__info, .full-story__text, .full-story__rate,
    .full-story__share, .full-story-header, .full-story-title, .full-story__poster,
    .full-story-desc, .full-story-tables, .full-story-links, .full-story-franchise,
    .full-story-additional, .header-f, .footer-f, .info-panel, .slider-block,
    .category-film, .user-favs { display: none !important; }
    html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }
    .content, #dle-content, .full-story, .fullstory { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
    #player, .player, .player iframe, .player video { width: 100% !important; max-width: 100% !important; height: 70vh !important; margin: 0 !important; }
    .translations { display: flex !important; flex-wrap: wrap !important; gap: 4px !important; padding: 8px !important; background: #111 !important; }
  `,
  seazonvar: `
    header, footer, nav, .sidebar, .comments, .related, .breadcrumbs,
    .site-header, .site-footer, .info-panel { display: none !important; }
    html, body { margin: 0 !important; padding: 0 !important; background: #000 !important; overflow-x: hidden !important; }
    #player, .player, .player iframe, .player video { width: 100% !important; max-width: 100% !important; height: 70vh !important; }
  `,
};

watch(() => props.sourceUrl, (newUrl, oldUrl) => {
  if (newUrl !== oldUrl) {
    started.value = false;
  }
});

async function startPlayer() {
  started.value = true;
  if (useWebview.value) {
    await nextTick();
    const wv = webviewEl.value;
    if (wv) {
      wv.addEventListener('dom-ready', () => {
        const css = PLAYER_ONLY_CSS[props.sourceName];
        if (css) wv.insertCSS(css).catch(() => {});
        wv.executeJavaScript(`
          window.open = () => null;
          document.addEventListener('click', function(e) {
            if (e.target.tagName === 'A' && e.target.target === '_blank') { e.preventDefault(); e.stopPropagation(); }
          }, true);
        `).catch(() => {});
      });
    }
  }
}
</script>

<style scoped>
.player-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  cursor: pointer;
  background: #0a0a1a;
  transition: background 0.2s;
}
.player-start:hover { background: #111128; }
.start-icon { font-size: 48px; margin-bottom: 12px; }
.start-text { font-size: 16px; color: var(--text-dim); }
.start-quality {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
  background: rgba(255,255,255,0.05);
  padding: 4px 10px;
  border-radius: 4px;
}
.iframe-wrap {
  width: 100%;
  background: #000;
  overflow: hidden;
}
.player-iframe {
  width: 100%;
  height: 75vh;
  border: none;
  display: block;
}
.player-webview {
  width: 100%;
  height: 75vh;
  border: none;
  display: block;
}
@media (max-width: 768px) {
  .player-start { min-height: 200px; }
  .start-icon { font-size: 36px; }
  .player-iframe, .player-webview { height: 60vh; }
}
@media (max-width: 480px) {
  .player-iframe, .player-webview { height: 50vh; }
}
</style>
