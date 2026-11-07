// Classify every raw video into track / masechta / daf (or an "extras" category), without guessing.
// Reads data/raw/*.json, writes data/classified.json and data/report.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHAS, DAF_TOTAL, CYCLES, findMasechta, heNum, cycleIndex, gem } from "./shas.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data", "raw");
const V = JSON.parse(fs.readFileSync(path.join(RAW, "videos.json"), "utf8"));
const P = JSON.parse(fs.readFileSync(path.join(RAW, "playlists.json"), "utf8"));

const DAY = 864e5;
const TRACKS = ["he-full", "he-only", "en-full", "en-only", "en-8", "he-8"];
const minutes = d => { const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []; return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60; };

// ---- title patterns (order matters) ----
const D = String.raw`(?<daf>\d+)(?<amud>[AB])?(?!\d)`; // handles "112by", "4A", "20B"
const PATTERNS = [
  { track: "en-only", re: new RegExp(String.raw`^(?:CHAZARAH\s*[-–]\s*)?(?<mas>.+?)\s+Daf\s*${D}`, "i"), need: /Nothing but the Daf/i },
  { track: "he-only", re: /^חזרה\s*[-–]\s*(?<mas>.+?)\s+דף\s+(?<daf>[א-ת'"״׳]+)/, need: /רק הדף/ },
  { track: "en-8", re: new RegExp(String.raw`^8 Min(?:ute)? Daf(?: by R.{1,3}Eli Stefansky)?\s*[-–]\s*(?<mas>.+?)\s+Daf\s*${D}`, "i") },
  { track: "he-8", re: /סיכום הדף בעברית\s+(?<mas>.+?)\s+דף\s+(?<daf>[א-ת'"״׳]+)/ },
  { track: "he-full", re: /^מרכז דף יומי\s*[-–]\s*(?<mas>.+?)\s+דף\s+(?<daf>[א-ת'"״׳]+)/ },
  { track: "en-full", re: new RegExp(String.raw`^(?:Daf Yomi\s+)?(?<mas>[A-Za-z' ()]+?)\s+(?:Daf|Dapim)\.?\s*${D}(?:\s*[-–&]\s*(?<to>\d+))?`, "i") },
  { track: "en-full", re: /^Daf Yomi\s+(?<mas>[A-Za-z' ()]+?)\s+(?<daf>\d+)(?:\s+Daf\b|\s+by\b)/i },
];
// playlist title → track (used as a cross-check, never to override the title)
function playlistTrack(t) {
  if (/^CHAZARAH/i.test(t)) return "en-only";
  if (/רק הדף/.test(t)) return "he-only";
  if (/^מרכז דף יומי/.test(t)) return "he-full";
  if (/^8 Min Eng$/i.test(t)) return "en-8";
  if (/^8 דקות$/.test(t)) return "he-8";
  if (/^Daf Yomi .+ by R/i.test(t) || /^Live Daf$/i.test(t)) return "en-full";
  return null;
}
function playlistMasechta(t) {
  const m = t.match(/^Daf Yomi (.+?) by R/i) || t.match(/^CHAZARAH - (.+?) \|/i) || t.match(/מסכת (.+?)(?: -| \||$)/);
  return m ? findMasechta(m[1].trim()) : null;
}
const EXTRA_PLAYLISTS = { "MDY Siyumim & More": "siyumim" };
// "Kereisos (Krisus)" → "Kereisos"
const cleanMas = s => s.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();

const vidPlaylists = {};
for (const [pid, p] of Object.entries(P)) for (const id of p.videoIds) (vidPlaylists[id] ||= []).push(pid);

const out = {};
for (const [id, v] of Object.entries(V)) {
  const pls = (vidPlaylists[id] || []).map(pid => P[pid].title);
  const rec = { id, title: v.title, date: v.publishedAt, min: Math.round(minutes(v.duration)), playlists: pls, flags: [] };
  out[id] = rec;
  if (v.privacyStatus !== "public") { rec.kind = "hidden"; rec.reason = "not public on YouTube: " + v.privacyStatus; continue; }
  if (v.embeddable === false) rec.flags.push("not-embeddable");

  // normalise (math-bold digits etc.); for English "Daf Yomi …" titles also try with Hebrew words removed
  let hit = null;
  const nt = v.title.normalize("NFKC").replace(/\s+/g, " ").trim();
  const variants = [nt];
  if (/^Daf Yomi /i.test(nt) && /[֐-׿]/.test(nt)) variants.push(nt.replace(/[֐-׿"']+/g, " ").replace(/\s+/g, " "));
  for (const t of variants) {
    hit = null;
    for (const p of PATTERNS) {
      const m = t.match(p.re);
      if (m && (!p.need || p.need.test(t))) { hit = { p, g: m.groups }; break; }
    }
    if (hit && findMasechta(cleanMas(hit.g.mas))) break;
  }
  if (!hit) {
    // not a daf shiur by title → "more shiurim" categories (approved by the user):
    //   siyumim: the Siyumim playlist, or Siyum / סיום / Hadran in the title
    //   8min:    8-minute summaries whose title has no parsable daf
    //   chizuk:  short clips (≤ 3 min)
    //   talks:   everything else (parsha talks, interviews, …)
    const extra = pls.map(t => EXTRA_PLAYLISTS[t]).find(Boolean);
    if (/\bdaf\b|דף/i.test(v.title) && pls.some(playlistTrack) && !/siyum|סיום/i.test(v.title)) { rec.kind = "unclassified"; rec.reason = "in a daf playlist but title not parsed"; continue; }
    rec.kind = "extra";
    if (extra || /siyum|סיום|hadran|הדרן/i.test(v.title)) rec.category = "siyumim";
    else if (/8 Min|eight minutes|סיכום הדף/i.test(v.title)) rec.category = "8min";
    else if (rec.min <= 3) rec.category = "chizuk";
    else rec.category = "talks";
    continue;
  }
  const mas = findMasechta(cleanMas(hit.g.mas));
  if (!mas) { rec.kind = "unclassified"; rec.reason = `unknown masechta name "${hit.g.mas}"`; continue; }
  const isHe = /[א-ת]/.test(hit.g.daf);
  const from = isHe ? heNum(hit.g.daf) : +hit.g.daf;
  const to = hit.g.to ? +hit.g.to : from;
  if (from == null) { rec.kind = "unclassified"; rec.reason = `daf "${hit.g.daf}" is not a valid Hebrew number`; continue; }
  if (from < mas.s || to > mas.e || to < from) { rec.kind = "unclassified"; rec.reason = `daf ${from}${to !== from ? "-" + to : ""} outside ${mas.en} ${mas.s}-${mas.e}`; continue; }

  // playlist cross-check
  const plTracks = [...new Set(pls.map(playlistTrack).filter(Boolean))];
  if (plTracks.length && !plTracks.includes(hit.p.track)) { rec.kind = "unclassified"; rec.reason = `title says ${hit.p.track}, playlist says ${plTracks.join("/")}`; continue; }
  const plMas = [...new Set(pls.map(playlistMasechta).filter(Boolean))];
  const plMasConflict = plMas.length && !plMas.includes(mas);

  // cycle from date; check the publish date fits the daf yomi calendar
  const t = Date.parse(v.publishedAt);
  const idx = cycleIndex(mas, from);
  let best = null;
  for (const [c, start] of Object.entries(CYCLES)) {
    const diff = Math.round((t - (start + idx * DAY)) / DAY);
    if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { cycle: +c, diff };
  }
  // title vs playlist disagree on masechta: trust the title only if the publish date matches that daf on the calendar
  if (plMasConflict) {
    if (Math.abs(best.diff) > 3) { rec.kind = "unclassified"; rec.reason = `title says ${mas.en}, playlist says ${plMas.map(m => m.en).join("/")}`; continue; }
    rec.flags.push(`in ${plMas.map(m => m.en).join("/")} playlist; title + date say ${mas.en}`);
  }
  if (hit.g.amud) rec.flags.push("amud " + hit.g.amud);
  rec.kind = "daf";
  rec.track = hit.p.track;
  rec.mas = mas.en;
  rec.dafs = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  rec.cycle = best.cycle;
  rec.dateDiff = best.diff;
  if (Math.abs(best.diff) > 7) rec.flags.push(`date off by ${best.diff} days`);
  if (to !== from) rec.flags.push("multi-daf");
  const sp = v.title.match(/by R[’'`]?\s*([^|(]+?)\s*(?:\(|\||$)/i);
  rec.speaker = sp ? sp[1].trim() : (/סטפנסקי|Stefansky/.test(v.title) ? "Eli Stefansky" : null);
  if (rec.speaker && !/Stefansky/i.test(rec.speaker)) rec.flags.push("speaker:" + rec.speaker);
  if (/unedited|לא ערוך/i.test(v.title)) rec.flags.push("unedited");
  if (/\bpart\s*\d/i.test(v.title)) rec.flags.push("part");
}

// Manual corrections approved by the user (data/overrides.json) win over the automatic result
const OV_FILE = path.join(ROOT, "data", "overrides.json");
const OV = fs.existsSync(OV_FILE) ? JSON.parse(fs.readFileSync(OV_FILE, "utf8")) : {};
for (const [id, o] of Object.entries(OV)) {
  const r = out[id];
  if (!r || id.startsWith("_") || r.kind === "hidden") continue;
  Object.assign(r, { kind: "daf", track: o.track, mas: o.mas, dafs: [o.daf], cycle: r.cycle || 14, dateDiff: 0, speaker: r.speaker || "Eli Stefansky" });
  delete r.reason;
  r.flags = [...(r.flags || []), "manual override"];
}

// Classification is uncertain if the date is far from the calendar → move to unclassified
for (const r of Object.values(out)) if (r.kind === "daf" && Math.abs(r.dateDiff) > 30) { r.kind = "unclassified"; r.reason = `title ${r.mas} ${r.dafs.join("-")} but published ${r.dateDiff} days away from that daf in any cycle`; }

fs.writeFileSync(path.join(ROOT, "data", "classified.json"), JSON.stringify(out, null, 1));

// ---------------- report ----------------
const all = Object.values(out);
const daf = all.filter(r => r.kind === "daf");
const L = [];
const pct = (a, b) => (100 * a / b).toFixed(1) + "%";
L.push(`# Classification report`, ``, `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${all.length} videos`, ``);
L.push(`| | videos |`, `|---|---|`, `| Daf shiurim | ${daf.length} |`, `| Extras | ${all.filter(r => r.kind === "extra").length} |`, `| Unclassified | ${all.filter(r => r.kind === "unclassified").length} |`, `| Hidden (unlisted/private on YouTube — not shown) | ${all.filter(r => r.kind === "hidden").length} |`, ``);

L.push(`## Per track`, ``, `| track | videos | cycle 13 (2012-2020) | cycle 14 (2020-) | dafim covered, cycle 14 | dafim covered, any cycle | first | last |`, `|---|---|---|---|---|---|---|---|`);
const cov = {};
for (const tr of TRACKS) {
  const rs = daf.filter(r => r.track === tr);
  const k14 = new Set(), kAny = new Set();
  for (const r of rs) for (const d of r.dafs) { const k = `${r.mas}-${d}`; kAny.add(k); if (r.cycle === 14) k14.add(k); }
  cov[tr] = { k14, kAny };
  const ds = rs.map(r => r.date).sort();
  L.push(`| ${tr} | ${rs.length} | ${rs.filter(r => r.cycle === 13).length} | ${rs.filter(r => r.cycle === 14).length} | ${k14.size} / ${DAF_TOTAL} (${pct(k14.size, DAF_TOTAL)}) | ${kAny.size} / ${DAF_TOTAL} (${pct(kAny.size, DAF_TOTAL)}) | ${ds[0]?.slice(0, 10) || ""} | ${ds.at(-1)?.slice(0, 10) || ""} |`);
}
L.push(``);

// coverage per masechta for cycle 14
L.push(`## Cycle 14 coverage per masechta (dafim with a video / dafim in masechta)`, ``, `| masechta | dafim | ${TRACKS.join(" | ")} |`, `|---|---|${TRACKS.map(() => "---").join("|")}|`);
for (const m of SHAS) {
  const n = m.e - m.s + 1;
  const cells = TRACKS.map(tr => { let c = 0; for (let d = m.s; d <= m.e; d++) if (cov[tr].k14.has(`${m.en}-${d}`)) c++; return c ? (c === n ? `**${c}**` : `${c}`) : "·"; });
  L.push(`| ${m.en} ${m.he} | ${n} | ${cells.join(" | ")} |`);
}
L.push(``);

// gaps in cycle 14 for tracks that are running now
L.push(`## Missing dafim inside the stretch each track ran in cycle 14`, ``);
for (const tr of TRACKS) {
  const rs = daf.filter(r => r.track === tr && r.cycle === 14);
  if (!rs.length) continue;
  const idxs = rs.flatMap(r => r.dafs.map(d => cycleIndex(SHAS.find(m => m.en === r.mas), d)));
  const lo = Math.min(...idxs), hi = Math.max(...idxs);
  const miss = [];
  let i = 0;
  for (const m of SHAS) for (let d = m.s; d <= m.e; d++, i++) if (i >= lo && i <= hi && !cov[tr].k14.has(`${m.en}-${d}`)) miss.push(`${m.en} ${d}`);
  L.push(`- **${tr}** (${hi - lo + 1} dafim in range): ${miss.length ? miss.length + " missing — " + miss.slice(0, 40).join(", ") + (miss.length > 40 ? ", …" : "") : "none missing"}`);
}
L.push(``);

// duplicates
L.push(`## Duplicates (more than one video for the same track + daf, same cycle)`, ``);
const groups = {};
for (const r of daf) for (const d of r.dafs) (groups[`${r.track}|${r.cycle}|${r.mas}-${d}`] ||= []).push(r);
const dups = Object.entries(groups).filter(([, a]) => a.length > 1);
const dupByTrack = {};
for (const [k] of dups) { const [tr, c] = k.split("|"); dupByTrack[`${tr} cycle ${c}`] = (dupByTrack[`${tr} cycle ${c}`] || 0) + 1; }
L.push(Object.entries(dupByTrack).map(([k, n]) => `- ${k}: ${n} dafim`).join("\n") || "- none", ``);
L.push(`<details><summary>All ${dups.length} duplicate groups</summary>`, ``);
for (const [k, a] of dups) {
  L.push(`- **${k.replace(/\|/g, " · ")}**`);
  for (const r of a.sort((x, y) => x.date.localeCompare(y.date))) L.push(`  - ${r.date.slice(0, 10)} · ${r.min} min · [${r.title}](https://youtu.be/${r.id})${r.flags.length ? " · _" + r.flags.join(", ") + "_" : ""}`);
}
L.push(``, `</details>`, ``);

// cross-cycle overlap
const crossKeys = new Set();
for (const tr of TRACKS) for (const k of cov[tr].kAny) { const c13 = daf.some(r => r.track === tr && r.cycle === 13 && r.dafs.some(d => `${r.mas}-${d}` === k)); if (c13 && cov[tr].k14.has(k)) crossKeys.add(tr + " " + k); }
L.push(`## Same daf in both cycles 13 and 14 (same track): ${crossKeys.size} dafim`, ``);

// flags
const flagCount = {};
for (const r of daf) for (const f of r.flags) { const key = f.replace(/-?\d+ days/, "N days"); flagCount[key] = (flagCount[key] || 0) + 1; }
L.push(`## Flags on classified videos`, ``, ...Object.entries(flagCount).sort((a, b) => b[1] - a[1]).map(([f, n]) => `- ${f}: ${n}`), ``);
L.push(`<details><summary>Videos with flags</summary>`, ``);
for (const r of daf.filter(r => r.flags.length)) L.push(`- ${r.track} · ${r.mas} ${r.dafs.join("-")} · c${r.cycle} · ${r.date.slice(0, 10)} · [${r.title}](https://youtu.be/${r.id}) · _${r.flags.join(", ")}_`);
L.push(``, `</details>`, ``);

// extras
const ex = all.filter(r => r.kind === "extra");
L.push(`## Extras`, ``);
for (const c of [...new Set(ex.map(r => r.category))]) L.push(`- ${c}: ${ex.filter(r => r.category === c).length}`);
L.push(``);

// unclassified
const un = all.filter(r => r.kind === "unclassified").sort((a, b) => b.date.localeCompare(a.date));
const reasons = {};
for (const r of un) { const k = r.reason.replace(/".*?"/, '"…"').replace(/-?\d+ days/, "N days").replace(/daf [\d-]+ outside .*/, "daf outside masechta range").replace(/title .* but published.*/, "date far from calendar"); reasons[k] = (reasons[k] || 0) + 1; }
L.push(`## Unclassified: ${un.length}`, ``, ...Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), ``);
L.push(`| date | min | title | reason | playlists |`, `|---|---|---|---|---|`);
for (const r of un) L.push(`| ${r.date.slice(0, 10)} | ${r.min} | [${r.title.replace(/\|/g, "/")}](https://youtu.be/${r.id}) | ${r.reason} | ${r.playlists.join("; ").replace(/\|/g, "/")} |`);

fs.writeFileSync(path.join(ROOT, "data", "report.md"), L.join("\n"));
console.log(L.slice(0, 80).join("\n"));
