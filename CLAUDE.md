# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
node server.js    # Start the Express server on port 3000
```

Initial setup (first time only):
```bash
node setup.js     # Downloads files and creates package.json
npm install
node server.js
```

There is no test suite or linter configured.

## Architecture

This is a Node.js/Express proxy server that bridges a mobile frontend with two external systems: a sports news GraphQL API and the NextSite CMS.

**`server.js`** — The entire backend. Key routes:
- `POST /cookie` — Stores the NextSite PHP session ID in memory for subsequent requests
- `GET /materias` — Fetches articles from the GaúchaZH GraphQL API (`gauchazh.clicrbs.com.br`)
- `GET /materia` — Scrapes full article body using Cheerio
- `POST /upload-foto` — Downloads an image and re-uploads it to NextSite CMS (`admin-dc4.nextsite.com.br`) with generated metadata
- `GET /app` — Serves the frontend SPA

**`app-duda.html`** — Self-contained frontend SPA (no build step). Runs entirely in the browser, communicates with `server.js` via fetch. Handles the full workflow: authenticate → browse articles → select photo → upload to CMS.

**Data flow:** Frontend authenticates with NextSite (PHP session cookie stored server-side) → fetches article list → user picks article and photo → server downloads image and POSTs to NextSite with auto-generated title/caption/slug.

**Text processing helpers in `server.js`:**
- `sanitizar()` — normalizes curly quotes and em-dashes
- `toSlug()` — converts article title to URL-safe filename
- `extrairPalavrasChave()` — extracts keywords (favors proper nouns) for photo naming
- `gerarLegenda()` — builds display captions

All UI text, comments, and variable names are in Portuguese.
