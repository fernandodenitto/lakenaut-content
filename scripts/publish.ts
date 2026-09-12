/**
 * Flip the status of concepts after you have reviewed them.
 * The site serves anything that is not `published` with noindex, and keeps it out of the sitemap,
 * so this is the switch that makes a concept visible to search engines.
 *
 *   node scripts/publish.ts --list                     what is in each state
 *   node scripts/publish.ts auto-loader copy-into      publish these ids
 *   node scripts/publish.ts --area catalog             publish every concept of an area
 *   node scripts/publish.ts --path foundations         publish every written concept of a path
 *   node scripts/publish.ts --all                      publish everything (asks for --yes)
 *   node scripts/publish.ts --status review <ids...>   set another status instead
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'content');
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const STATUSES = new Set(['draft', 'review', 'published']);
const target = opt('status') ?? 'published';
if (!STATUSES.has(target)) {
  console.error(`Unknown status "${target}". Use draft, review or published.`);
  process.exit(1);
}

const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
      })
    : [];

const files = walk(path.join(ROOT, 'concepts'));
const docs = files.map((file) => ({ file, id: path.basename(file, '.md'), fm: matter(fs.readFileSync(file, 'utf8')).data as Record<string, unknown> }));

if (flag('list')) {
  const by = new Map<string, string[]>();
  for (const d of docs) {
    const s = String(d.fm.status ?? 'draft');
    (by.get(s) ?? by.set(s, []).get(s)!).push(d.id);
  }
  for (const [s, ids] of [...by].sort()) {
    console.log(`\n${s} (${ids.length})`);
    console.log('  ' + ids.sort().join(', '));
  }
  process.exit(0);
}

let ids: string[] = argv.filter((a) => !a.startsWith('--') && a !== target);

const area = opt('area');
if (area) ids = docs.filter((d) => d.fm.area === area).map((d) => d.id);

const pathId = opt('path');
if (pathId) {
  const f = path.join(ROOT, 'paths', `${pathId}.md`);
  if (!fs.existsSync(f)) {
    console.error(`No such path: ${pathId}`);
    process.exit(1);
  }
  const stages = (matter(fs.readFileSync(f, 'utf8')).data as { stages?: { concepts?: string[] }[] }).stages ?? [];
  const wanted = new Set(stages.flatMap((s) => s.concepts ?? []));
  ids = docs.filter((d) => wanted.has(d.id)).map((d) => d.id);
}

if (flag('all')) {
  if (!flag('yes')) {
    console.error(`--all would set ${docs.length} concepts to "${target}". Re-run with --yes if that is what you want.`);
    process.exit(1);
  }
  ids = docs.map((d) => d.id);
}

if (!ids.length) {
  console.error('Nothing selected. Pass ids, or --area <id>, --path <id>, --all, or --list.');
  process.exit(1);
}

const byId = new Map(docs.map((d) => [d.id, d]));
let changed = 0;
const missing: string[] = [];
for (const id of ids) {
  const d = byId.get(id);
  if (!d) {
    missing.push(id);
    continue;
  }
  const raw = fs.readFileSync(d.file, 'utf8');
  const current = String(d.fm.status ?? 'draft');
  if (current === target) continue;
  if (!/^status:\s*\w+\s*$/m.test(raw)) {
    console.error(`${id}: no status line, skipped`);
    continue;
  }
  fs.writeFileSync(d.file, raw.replace(/^status:\s*\w+\s*$/m, `status: ${target}`));
  console.log(`${id}: ${current} → ${target}`);
  changed++;
}
if (missing.length) console.error(`\nUnknown ids: ${missing.join(', ')}`);
console.log(`\n${changed} concepts set to ${target}. Run npm run validate, then rebuild the site.`);
