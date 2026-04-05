# Watchflix

Stream movies and TV shows from multiple sources. Desktop app built with Electron, Vue.js, and Express.

## Download

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [Watchflix-1.0.0-arm64.dmg](https://github.com/stuk88/watchflix/releases/latest) |
| macOS (Intel) | [Watchflix-1.0.0.dmg](https://github.com/stuk88/watchflix/releases/latest) |
| Windows | [Watchflix Setup 1.0.0.exe](https://github.com/stuk88/watchflix/releases/latest) |
| Linux (AppImage) | [Watchflix-1.0.0.AppImage](https://github.com/stuk88/watchflix/releases/latest) |
| Linux (tar.gz) | [watchflix-desktop-1.0.0.tar.gz](https://github.com/stuk88/watchflix/releases/latest) |

Or visit the [download page](https://stuk88.github.io/watchflix/).

## Features

- Browse and search movies/TV shows with metadata from TMDB
- Stream via 123movies with embedded player (header/ad stripping, full-width video)
- Subtitle support with automatic encoding detection (jschardet + iconv-lite)
- WebTorrent streaming as alternative source
- "Load more" pagination with infinite scroll
- Responsive UI for desktop, tablet, and mobile
- Cross-platform desktop builds (macOS, Windows, Linux)
- Mobile support via Capacitor (Android, iOS)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | Vue 3, Vue Router, Pinia, Vite |
| API | Express, better-sqlite3, Cheerio, Axios |
| Desktop | Electron 34, electron-builder |
| Mobile | Capacitor 6 |
| Testing | Playwright (E2E) |
| CI/CD | GitHub Actions, GitHub Releases |

## Project Structure

```
watchflix/
  api/          Express backend — scraping, DB, subtitle proxy
  ui/           Vue 3 SPA — browse, search, player
  desktop/      Electron shell — iframe sandboxing, native builds
  mobile/       Capacitor wrapper — Android & iOS
  scripts/      Build helpers (prebuild-api.sh)
  docs/         GitHub Pages download site
```

## Development

```bash
# Install all workspace dependencies
npm install

# Run API + UI in dev mode
npm run dev

# Run full desktop dev (API + UI + Electron)
npm run desktop:dev
```

## Building

```bash
# macOS DMG (arm64 + x64)
npm run desktop:build:mac

# Windows NSIS installer
npm run desktop:build:win

# Linux (AppImage + deb + tar.gz)
npm run desktop:build:linux
```

Build artifacts are output to `desktop/dist/`.

## Mobile

```bash
# Android
npm run mobile:android

# iOS
npm run mobile:ios
```

Requires Android Studio or Xcode respectively.

## Testing

```bash
# Desktop E2E tests (Playwright)
npm run test:e2e

# API unit tests
npm test -w api
```

## CI/CD

Every push to `main` triggers a [GitHub Actions workflow](.github/workflows/build.yml) that builds packages for macOS, Windows, and Linux, then publishes them as a GitHub Release.

## Legal

This software is for **educational and personal research purposes only**. It does not host, store, or distribute any copyrighted media content. See [DISCLAIMER.md](DISCLAIMER.md) and [LICENSE](LICENSE) for full terms.
