// Shas in Daf Yomi order — same table as the approved prototype (prototype/mdy-shiurim.html).
// [en, he, firstDaf, lastDaf, seder, extra aliases]
export const SHAS = [
  ["Berachos", "ברכות", 2, 64, 0, "Berachot Brachos Brochos"],
  ["Shabbos", "שבת", 2, 157, 1, "Shabbat Shabbath Shabbes"], ["Eruvin", "עירובין", 2, 105, 1, "Eiruvin"], ["Pesachim", "פסחים", 2, 121, 1, "Pesahim"], ["Shekalim", "שקלים", 2, 22, 1, ""], ["Yoma", "יומא", 2, 88, 1, ""], ["Sukkah", "סוכה", 2, 56, 1, "Sukka Succah Succa"], ["Beitzah", "ביצה", 2, 40, 1, "Beitza Beitzah Beitza"], ["Rosh Hashanah", "ראש השנה", 2, 35, 1, "Rosh Hashana"], ["Taanis", "תענית", 2, 31, 1, "Taanit"], ["Megillah", "מגילה", 2, 32, 1, "Megila Megilla"], ["Moed Katan", "מועד קטן", 2, 29, 1, ""], ["Chagigah", "חגיגה", 2, 27, 1, "Chagiga Hagigah"],
  ["Yevamos", "יבמות", 2, 122, 2, "Yevamot"], ["Kesubos", "כתובות", 2, 112, 2, "Ketubot Kesuvos Kesubot"], ["Nedarim", "נדרים", 2, 91, 2, ""], ["Nazir", "נזיר", 2, 66, 2, ""], ["Sotah", "סוטה", 2, 49, 2, "Sota"], ["Gittin", "גיטין", 2, 90, 2, "Gitin"], ["Kiddushin", "קידושין", 2, 82, 2, "Kidushin"],
  ["Bava Kamma", "בבא קמא", 2, 119, 3, "Bava Kama|Baba Kama|Baba Kamma"], ["Bava Metzia", "בבא מציעא", 2, 119, 3, "Baba Metzia"], ["Bava Basra", "בבא בתרא", 2, 176, 3, "Bava Batra|Baba Basra|Baba Batra"], ["Sanhedrin", "סנהדרין", 2, 113, 3, ""], ["Makkos", "מכות", 2, 24, 3, "Makkot Makos Makot"], ["Shevuos", "שבועות", 2, 49, 3, "Shevuot Shavuos Shvuos"], ["Avodah Zarah", "עבודה זרה", 2, 76, 3, "Avoda Zara|Avodah Zara|Avoda Zarah"], ["Horayos", "הוריות", 2, 14, 3, "Horayot"],
  ["Zevachim", "זבחים", 2, 120, 4, "Zevahim Zvachim"], ["Menachos", "מנחות", 2, 110, 4, "Menachot"], ["Chullin", "חולין", 2, 142, 4, "Chulin Hullin"], ["Bechoros", "בכורות", 2, 61, 4, "Bechorot Bekhorot"], ["Arachin", "ערכין", 2, 34, 4, "Arakhin Erchin Arachen"], ["Temurah", "תמורה", 2, 34, 4, "Temura"], ["Kereisos", "כריתות", 2, 28, 4, "Keritot Krisos Kerisos Kreisos Krisus Kerisus"], ["Meilah", "מעילה", 2, 22, 4, "Meila"], ["Kinnim", "קינים", 23, 25, 4, "Kinim"], ["Tamid", "תמיד", 26, 33, 4, ""], ["Middos", "מידות", 34, 37, 4, "Middot Midos Midot"],
  ["Niddah", "נדה", 2, 73, 5, "Nidah Nida Nidda"],
].map(([en, he, s, e, o, al], i) => ({ i, en, he, s, e, o, aliases: [en, ...(al.includes("|") ? al.split("|") : al.split(" ")).filter(Boolean)] }));

export const DAF_TOTAL = SHAS.reduce((a, m) => a + m.e - m.s + 1, 0); // 2711
export const CYCLES = { 13: Date.UTC(2012, 7, 3), 14: Date.UTC(2020, 0, 5), 15: Date.UTC(2027, 5, 7) };

const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
export function gem(n) {
  let s = "";
  for (const [v, c] of H) while (n >= v) {
    if (v === 10 && (n % 100 === 15 || n % 100 === 16)) { s += n % 100 === 15 ? "טו" : "טז"; n -= n % 100; continue; }
    s += c; n -= v;
  }
  return s;
}
const VAL = Object.fromEntries(H.map(([v, c]) => [c, v]));
// Hebrew numeral → number, only if it is written canonically (so typos are rejected, not guessed)
export function heNum(raw) {
  const s = raw.replace(/[^א-ת]/g, "");
  if (!s || s.length > 4) return null;
  const n = [...s].reduce((a, c) => a + (VAL[c] || 0), 0);
  return gem(n) === s ? n : null;
}

const norm = s => s.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-zא-ת ]/g, " ").replace(/\s+/g, " ").trim();
const NAME_INDEX = new Map();
for (const m of SHAS) for (const n of [m.he, ...m.aliases]) NAME_INDEX.set(norm(n), m);
export function findMasechta(name) { return NAME_INDEX.get(norm(name)) || null; }

// position of (masechta, daf) inside a cycle, 0..2710
export function cycleIndex(m, d) {
  let idx = 0;
  for (const x of SHAS) { if (x === m) return idx + (d - x.s); idx += x.e - x.s + 1; }
}
export function dafForDate(t) {
  const day = Math.floor((t - CYCLES[14]) / 864e5);
  let idx = ((day % DAF_TOTAL) + DAF_TOTAL) % DAF_TOTAL;
  for (const m of SHAS) { const len = m.e - m.s + 1; if (idx < len) return { m, d: m.s + idx }; idx -= len; }
}
