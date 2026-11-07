// Fetch raw data from YouTube Data API v3 into data/raw/.
// Incremental: known videos are not re-fetched; playlists are re-read only when their itemCount changed.
// Usage: node scripts/fetch.mjs [--full] [--handle MercazDafYomi] [--handle OtherHandle]
// Key: YOUTUBE_API_KEY from env or .env (never committed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw");
fs.mkdirSync(RAW, { recursive: true });

function loadKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY.trim();
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^YOUTUBE_API_KEY=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error("YOUTUBE_API_KEY missing (set it in .env or as an environment variable)");
}
const KEY = loadKey();
const args = process.argv.slice(2);
const FULL = args.includes("--full");
const handles = args.flatMap((a, i) => (a === "--handle" ? [args[i + 1]] : []));
if (!handles.length) handles.push("MercazDafYomi");

let units = 0;
async function api(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    units += endpoint === "search" ? 100 : 1;
    const j = await res.json();
    if (!j.error) return j;
    if (attempt < 3 && res.status >= 500) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    throw new Error(`${endpoint}: ${j.error.code} ${j.error.message}`);
  }
}
async function pages(endpoint, params) {
  const out = [];
  let pageToken;
  do {
    const j = await api(endpoint, { ...params, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    out.push(...j.items);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}
const readJSON = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));

const F_CHANNELS = path.join(RAW, "channels.json");
const F_PLAYLISTS = path.join(RAW, "playlists.json");
const F_VIDEOS = path.join(RAW, "videos.json");

const channels = readJSON(F_CHANNELS, {});
const playlists = FULL ? {} : readJSON(F_PLAYLISTS, {});
const videos = FULL ? {} : readJSON(F_VIDEOS, {});

const wanted = new Set(); // video ids we must have details for

for (const handle of handles) {
  const c = (await api("channels", { part: "snippet,contentDetails,statistics", forHandle: handle })).items?.[0];
  if (!c) { console.log(`! handle @${handle} not found`); continue; }
  channels[c.id] = { handle, title: c.snippet.title, description: c.snippet.description, uploads: c.contentDetails.relatedPlaylists.uploads, stats: c.statistics, fetchedAt: new Date().toISOString() };
  console.log(`channel @${handle}: ${c.snippet.title} (${c.statistics.videoCount} videos)`);

  // Uploads: newest first, stop at first known video unless --full
  const known = new Set(Object.keys(videos));
  let pageToken, added = 0, stop = false;
  do {
    const j = await api("playlistItems", { part: "contentDetails", playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    for (const it of j.items) {
      const id = it.contentDetails.videoId;
      if (known.has(id)) { stop = true; break; }
      wanted.add(id); added++;
    }
    pageToken = j.nextPageToken;
  } while (pageToken && !stop);
  console.log(`  uploads: ${added} new video ids`);

  // Playlists: re-read items only when itemCount changed
  const pls = await pages("playlists", { part: "snippet,contentDetails", channelId: c.id });
  for (const p of pls) {
    const prev = playlists[p.id];
    const count = p.contentDetails.itemCount;
    // "active" playlists (a video from the last 30 days) are re-read every run: an unedited upload can be
    // swapped for the edited one without changing itemCount
    const active = prev && prev.videoIds.some(id => videos[id] && Date.now() - Date.parse(videos[id].publishedAt) < 30 * 864e5);
    if (prev && prev.itemCount === count && !active) { prev.title = p.snippet.title; continue; }
    const items = await pages("playlistItems", { part: "contentDetails", playlistId: p.id });
    playlists[p.id] = { channelId: c.id, title: p.snippet.title, description: p.snippet.description, publishedAt: p.snippet.publishedAt, itemCount: count, videoIds: items.map(i => i.contentDetails.videoId) };
    for (const id of playlists[p.id].videoIds) if (!videos[id]) wanted.add(id);
  }
  // drop playlists that disappeared from this channel
  const live = new Set(pls.map(p => p.id));
  for (const [id, p] of Object.entries(playlists)) if (p.channelId === c.id && !live.has(id)) delete playlists[id];
  console.log(`  playlists: ${pls.length}`);
}

// Video details in batches of 50 (1 unit per 50 videos).
// New videos are fetched; known videos are re-checked too (~120 units for the whole channel) so that
// videos that were deleted or made unlisted — e.g. the daily "unedited" upload once the edited one is up — drop out.
const ids = [...wanted].filter(id => !videos[id]);
const recheck = Object.keys(videos).filter(id => !wanted.has(id));
let removed = 0;
for (const [list, isRecheck] of [[ids, false], [recheck, true]]) for (let i = 0; i < list.length; i += 50) {
  const batch = list.slice(i, i + 50);
  const j = await api("videos", { part: "snippet,contentDetails,status", id: batch.join(",") });
  if (isRecheck) {
    const back = new Set(j.items.map(v => v.id));
    for (const id of batch) if (!back.has(id)) { delete videos[id]; removed++; }
  }
  for (const v of j.items) {
    videos[v.id] = {
      channelId: v.snippet.channelId,
      title: v.snippet.title,
      description: v.snippet.description,
      publishedAt: v.snippet.publishedAt,
      duration: v.contentDetails.duration,
      liveBroadcastContent: v.snippet.liveBroadcastContent,
      privacyStatus: v.status.privacyStatus,
      embeddable: v.status.embeddable,
      defaultAudioLanguage: v.snippet.defaultAudioLanguage || null,
    };
  }
}

// Safety net: a normal day removes a handful of videos (the replaced "unedited" uploads).
// If many disappear at once it is more likely an API problem than real deletions — stop without saving.
if (removed > 50 && !args.includes("--allow-mass-delete")) {
  console.error(`! ${removed} known videos missing from the API response — not saving. Re-run with --allow-mass-delete if this is real.`);
  process.exit(1);
}

writeJSON(F_CHANNELS, channels);
writeJSON(F_PLAYLISTS, playlists);
writeJSON(F_VIDEOS, videos);
console.log(`done: ${ids.length} new videos, ${removed} deleted videos removed, ${recheck.length} re-checked,${Object.keys(videos).length} videos total, ${Object.keys(playlists).length} playlists, ~${units} API units used`);
