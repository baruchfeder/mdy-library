// Build site/videos.json from data/classified.json.
// One video per track + daf, chosen by the rule approved by the user:
//   1. current cycle (14) before the previous cycle (13)
//   2. edited before "unedited" / "לא ערוך"
//   3. the full shiur before parts / short clips (longest first)
//   4. then the newest
// Other videos of the same daf in the same cycle are kept as "alt" (e.g. part 2).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "classified.json"), "utf8"));
const all = Object.values(C);

const unedited = r => r.flags.includes("unedited");
const better = (a, b) =>
  (b.cycle - a.cycle) ||
  (unedited(a) - unedited(b)) ||
  (b.min - a.min) ||
  b.date.localeCompare(a.date);

const slim = r => {
  const o = { id: r.id, t: r.title, d: r.date.slice(0, 10), m: r.min };
  if (r.cycle && r.cycle !== 14) o.c = r.cycle;
  if (r.speaker && !/Stefansky/i.test(r.speaker)) o.s = r.speaker;
  return o;
};

const groups = {};
for (const r of all.filter(r => r.kind === "daf")) for (const d of r.dafs) ((groups[r.track] ||= {})[`${r.mas}-${d}`] ||= []).push(r);

const tracks = {};
const stats = {};
for (const [tr, byDaf] of Object.entries(groups)) {
  tracks[tr] = {};
  stats[tr] = { dafim: 0, fromPrevCycle: 0, withAlt: 0 };
  for (const [key, rs] of Object.entries(byDaf)) {
    rs.sort(better);
    const best = rs[0];
    const e = slim(best);
    const alt = rs.slice(1).filter(r => r.cycle === best.cycle && !unedited(r));
    if (alt.length) { e.alt = alt.map(slim); stats[tr].withAlt++; }
    tracks[tr][key] = e;
    stats[tr].dafim++;
    if (best.cycle !== 14) stats[tr].fromPrevCycle++;
  }
}

// "More shiurim" lists, newest first. The 8min list also holds every 8-minute daf video (en-8 and he-8).
const extras = { "8min": [], talks: [], chizuk: [], siyumim: [] };
const extraRecs = all.filter(r => r.kind === "extra" || (r.kind === "daf" && (r.track === "en-8" || r.track === "he-8")));
for (const r of extraRecs.sort((a, b) => b.date.localeCompare(a.date))) {
  const cat = r.kind === "daf" ? "8min" : r.category;
  const e = { id: r.id, t: r.title, d: r.date.slice(0, 10), m: r.min };
  (extras[cat] ||= []).push(e);
}

const out = { generated: new Date().toISOString(), channel: "@MercazDafYomi", tracks, extras };
fs.mkdirSync(path.join(ROOT, "site"), { recursive: true });
const file = path.join(ROOT, "site", "videos.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`site/videos.json: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
for (const [tr, s] of Object.entries(stats)) console.log(`  ${tr}: ${s.dafim} dafim (${s.fromPrevCycle} from previous cycle), ${s.withAlt} with extra parts`);
for (const [c, a] of Object.entries(extras)) console.log(`  extras/${c}: ${a.length}`);
