import Database from 'better-sqlite3';
import { config } from '../src/config.js';

const db = new Database(config.databasePath);

const rows: any[] = db
  .prepare(
    `
  SELECT s.id, s.matchScore, s.makeModel, s.likelyModel, s.photoQualityScore, s.analysisDetails,
         l.price, l.distanceMiles, l.imageUrls
  FROM scores s
  JOIN listings l ON l.url = s.listingUrl
  WHERE s.matchScore IS NOT NULL
`,
  )
  .all();

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function recompute(row: any): number {
  const base = row.matchScore as number;
  if (base <= 25) return base;

  let delta = 0;

  if (row.distanceMiles !== null) {
    delta += clamp(10 - 0.16 * row.distanceMiles, -8, 10);
  }

  if (row.price && row.price > 0 && row.price <= config.maxPrice) {
    const ratio = 1 - row.price / config.maxPrice;
    delta += clamp(ratio * 8, 0, 6);
  }

  if (row.photoQualityScore > 0) {
    delta += clamp((row.photoQualityScore - 60) / 12, -4, 4);
  }

  const photos = JSON.parse(row.imageUrls || '[]');
  const pc = new Set<string>(photos).size;
  if (pc === 1) delta -= 5;
  else if (pc === 2) delta -= 2;
  else if (pc >= 6) delta += 1.5;

  const haystack = `${row.makeModel ?? ''} ${row.likelyModel ?? ''}`.toLowerCase();
  if (/\b(old town hunter|stillwater|osprey 140|sportspal|radisson|coleman ram[\s-]?x)\b/.test(haystack)) {
    delta += 5;
  } else if (/\b(mohawk|wenonah|grumman|old town|alumacraft)\b/.test(haystack)) {
    delta += 2;
  }

  const details = JSON.parse(row.analysisDetails || '{}');
  const known = Object.values(details).filter((v: any) => {
    if (v === null || v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    return s.length > 0 && s !== 'unknown' && s !== 'null';
  }).length;
  delta += clamp((known - 18) / 4, -3, 3);

  const capped = clamp(delta, -15, 18);
  return clamp(Math.round(base + capped), 0, 100);
}

const update = db.prepare('UPDATE scores SET matchScore = ? WHERE id = ?');
let changed = 0;
for (const row of rows) {
  const next = recompute(row);
  if (next !== row.matchScore) {
    update.run(next, row.id);
    changed += 1;
    console.log(`  ${row.matchScore} -> ${next}  (id ${row.id})`);
  }
}
console.log(`\nUpdated ${changed} of ${rows.length} scores.`);
db.close();
