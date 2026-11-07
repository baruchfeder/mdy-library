# MDY Library · ספריית שיעורי MDY

Static site for the Daf Yomi shiurim of R' Eli Stefansky (Mercaz Daf Yomi), with videos embedded from YouTube.

- `site/` — the website (`index.html` + `videos.json`), published by GitHub Pages
- `scripts/fetch.mjs` — pulls the channel from YouTube Data API v3 into `data/raw/` (incremental)
- `scripts/classify.mjs` — classifies each video (track / masechta / daf, or "more shiurim" category) → `data/classified.json`, `data/report.md`
- `scripts/build.mjs` — picks one video per track + daf and writes `site/videos.json`
- `.github/workflows/update.yml` — runs the three scripts twice a day and redeploys

Local run: put `YOUTUBE_API_KEY=...` in `.env`, then
```
node scripts/fetch.mjs && node scripts/classify.mjs && node scripts/build.mjs
node scripts/serve.mjs   # http://localhost:8080
```
