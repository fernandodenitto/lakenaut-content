/**
 * Validazione del vault. Uso: node scripts/validate.ts [--strict]
 * Esce con codice 1 se ci sono errori. Gli avvisi non bloccano (salvo --strict).
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'content');
const strict = process.argv.includes('--strict');
const errors: string[] = [];
const warnings: string[] = [];
const err = (f: string, m: string) => errors.push(`${rel(f)}: ${m}`);
const warn = (f: string, m: string) => warnings.push(`${rel(f)}: ${m}`);
const rel = (f: string) => path.relative(path.dirname(ROOT), f);

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Sidebar group -> the folder it lives in, numbered so the vault lists in the site's order. */
const GROUP_FOLDER: Record<string, string> = {
  foundations: '01-foundations',
  main: '02-workspace',
  sql: '03-sql',
  'data-engineering': '04-data-engineering',
  'ai-ml': '05-ai-ml',
};

const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const STATUSES = new Set(['draft', 'review', 'published']);
const MATURITIES = new Set(['ga', 'public-preview', 'beta', 'private-preview', 'deprecated']);
const GROUPS = new Set(['foundations', 'main', 'sql', 'data-engineering', 'ai-ml']);
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const EMBED = /!\[\[[^\]]+\]\]/g;
const IMG = /!\[[^\]]*\]\(([^)]+)\)/g;
const SNIPPET = /\{\{\s*snippet:\s*([a-z0-9-]+)\s*\}\}/g;
const CODE_FENCE = /```[\s\S]*?```/g;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.startsWith('.') ? [] : walk(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

interface Doc {
  file: string;
  id: string;
  data: Record<string, any>;
  body: string;
}
const load = (files: string[]): Doc[] =>
  files.map((file) => {
    try {
      const { data, content } = matter(fs.readFileSync(file, 'utf8'));
      return { file, id: path.basename(file, '.md'), data, body: content };
    } catch (e) {
      err(file, `frontmatter non leggibile: ${(e as Error).message.split('\n')[0]}`);
      return { file, id: path.basename(file, '.md'), data: {}, body: '' };
    }
  });

const concepts = load(walk(path.join(ROOT, 'concepts')));
const areas = load(walk(path.join(ROOT, 'areas')));
const roadmaps = load(walk(path.join(ROOT, 'roadmaps')));
const paths = load(walk(path.join(ROOT, 'paths')));
const snippets = new Set(walk(path.join(ROOT, 'snippets')).map((f) => path.basename(f, '.md')));

const conceptIds = new Set(concepts.map((c) => c.id));
const areaIds = new Set(areas.map((a) => a.id));
const roadmapIds = new Set(roadmaps.map((r) => r.id));
const pathIds = new Set(paths.map((p) => p.id));
const linkable = new Set([...conceptIds, ...areaIds, ...roadmapIds, ...pathIds]);
const areaById = new Map(areas.map((a) => [a.id, a]));
const backlinks = new Map<string, Set<string>>();
const addBacklink = (to: string, from: string) => {
  if (!backlinks.has(to)) backlinks.set(to, new Set());
  backlinks.get(to)!.add(from);
};

const dup = new Map<string, number>();
for (const d of [...concepts, ...areas, ...roadmaps, ...paths]) dup.set(d.id, (dup.get(d.id) ?? 0) + 1);
for (const [id, n] of dup) if (n > 1) errors.push(`id duplicato: ${id} (${n} file)`);

// ---------- Aree ----------
for (const a of areas) {
  const d = a.data;
  if (d.id !== a.id) err(a.file, `id "${d.id}" diverso dal nome file "${a.id}"`);
  for (const k of ['title', 'label', 'sidebar_group', 'order']) if (d[k] === undefined || d[k] === '') err(a.file, `missing "${k}"`);
  if (!GROUPS.has(d.sidebar_group)) err(a.file, `invalid sidebar_group: ${d.sidebar_group}`);
  for (const id of d.concept_order ?? []) if (!conceptIds.has(id)) err(a.file, `concept_order contiene "${id}" che non esiste`);
}

// ---------- Roadmap ----------
const roadmapDomains = new Map<string, Set<string>>();
for (const r of roadmaps) {
  const d = r.data;
  if (d.id !== r.id) err(r.file, `id "${d.id}" diverso dal nome file "${r.id}"`);
  for (const k of ['title', 'exam_guide_version', 'exam_guide_url', 'domains']) if (!d[k]) err(r.file, `missing "${k}"`);
  const names = new Set<string>();
  let weight = 0;
  for (const dom of d.domains ?? []) {
    if (!dom.name) err(r.file, 'dominio senza name');
    names.add(dom.name);
    weight += Number(dom.weight ?? 0);
    for (const id of dom.concepts ?? []) {
      if (!conceptIds.has(id)) err(r.file, `dominio "${dom.name}": concetto "${id}" non esiste`);
      else addBacklink(id, r.id);
    }
  }
  if (weight && Math.abs(weight - 100) > 1) warn(r.file, `i pesi dei domini sommano a ${weight}, non 100`);
  roadmapDomains.set(r.id, names);
  for (const t of d.prerequisite_tracks ?? []) if (!areaIds.has(t) && !roadmapIds.has(t)) warn(r.file, `prerequisite_tracks: "${t}" non esiste`);
}

// ---------- Path ----------
const LEVELS_P = new Set(['beginner', 'intermediate', 'advanced']);
for (const p of paths) {
  const d = p.data;
  if (d.id !== p.id) err(p.file, `id "${d.id}" diverso dal nome file "${p.id}"`);
  for (const k of ['title', 'summary', 'level', 'order', 'stages']) if (d[k] === undefined || d[k] === '') err(p.file, `missing "${k}"`);
  if (d.level && !LEVELS_P.has(d.level)) err(p.file, `invalid level: ${d.level}`);
  for (const c of d.certs ?? []) if (!roadmapIds.has(c)) err(p.file, `certs: "${c}" non esiste in roadmaps/`);
  const seenNodes = new Set<string>();
  let planned = 0;
  for (const st of d.stages ?? []) {
    if (!st.name) err(p.file, 'stage senza name');
    for (const id of st.concepts ?? []) {
      if (seenNodes.has(id)) err(p.file, `concetto "${id}" ripetuto nel path`);
      seenNodes.add(id);
      if (conceptIds.has(id)) addBacklink(id, p.id);
      else planned++;
    }
  }
  if (!seenNodes.size) err(p.file, 'path senza concetti');
  if (planned) warn(p.file, `${planned} nodi pianificati (concetto non ancora scritto)`);
}

// ---------- Concetti ----------
for (const c of concepts) {
  const d = c.data;
  const f = c.file;
  if (!ID_RE.test(c.id)) err(f, `file name is not ASCII kebab-case`);
  if (d.id !== c.id) err(f, `id "${d.id}" does not match the file name "${c.id}"`);
  for (const k of ['title', 'area', 'summary', 'updated', 'status']) if (d[k] === undefined || d[k] === '') err(f, `missing "${k}"`);
  if (d.level && !LEVELS.has(d.level)) err(f, `invalid level: ${d.level}`);
  if (d.status && !STATUSES.has(d.status)) err(f, `invalid status: ${d.status}`);
  if (d.maturity && !MATURITIES.has(d.maturity)) err(f, `invalid maturity: ${d.maturity}`);
  if (d.maturity && d.maturity !== 'ga' && !d.maturity_checked) err(f, `maturity "${d.maturity}" richiede maturity_checked`);
  if (typeof d.summary === 'string' && d.summary.length > 220) warn(f, `summary is long (${d.summary.length} characters)`);

  const area = areaById.get(d.area);
  if (!area) err(f, `area "${d.area}" does not exist in areas/`);
  else {
    // The vault mirrors the site's sidebar: a numbered group folder, then one folder per area.
    // The number is only there so a file explorer lists the groups in the order the site does.
    const folder = path.relative(path.join(ROOT, 'concepts'), path.dirname(f)).split(path.sep).join('/');
    const expected = `${GROUP_FOLDER[area.data.sidebar_group]}/${area.id}`;
    if (folder !== expected) err(f, `folder "${folder}" should be "${expected}" for area "${area.id}"`);
  }

  for (const k of ['prerequisites', 'related'] as const) {
    for (const id of d[k] ?? []) {
      if (id === c.id) warn(f, `${k} lists the concept itself`);
      else if (!conceptIds.has(id)) err(f, `${k}: "${id}" does not exist`);
      else addBacklink(id, c.id);
    }
  }
  for (const e of d.exams ?? []) {
    if (!roadmapIds.has(e.cert)) err(f, `exams: cert "${e.cert}" does not exist in roadmaps/`);
    else if (e.domain && !roadmapDomains.get(e.cert)!.has(e.domain)) err(f, `exams: domain "${e.domain}" is not part of ${e.cert}`);
  }
  for (const s of d.sources ?? []) if (!/^https?:\/\//.test(s?.url ?? '')) err(f, `sources: invalid url "${s?.url}"`);
  if (d.status === 'published' && !(d.sources ?? []).length) warn(f, 'published without sources');

  const bodyNoCode = c.body.replace(CODE_FENCE, '');
  for (const m of bodyNoCode.matchAll(EMBED)) err(f, `Obsidian embed the site cannot render: ${m[0]}`);
  for (const m of bodyNoCode.matchAll(WIKILINK)) {
    const id = m[1].trim();
    if (!linkable.has(id)) err(f, `wikilink does not resolve: [[${id}]]`);
    else if (conceptIds.has(id) && id !== c.id) addBacklink(id, c.id);
  }
  for (const m of bodyNoCode.matchAll(IMG)) {
    const src = m[1].split(' ')[0];
    if (/^https?:\/\//.test(src)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(f), src))) err(f, `missing image: ${src}`);
  }
  for (const m of c.body.matchAll(SNIPPET)) if (!snippets.has(m[1])) err(f, `missing snippet: ${m[1]}`);
  if (!/^## /m.test(c.body)) warn(f, 'no ## section in the body');
  if ((d.exams ?? []).length && !/\[!exam\]/.test(c.body)) warn(f, 'mapped to an exam objective but has no [!exam] callout');
}

// Orphans: no related entries and nothing links here.
for (const c of concepts) {
  const hasOut = (c.data.related ?? []).length > 0;
  const hasIn = (backlinks.get(c.id)?.size ?? 0) > 0;
  if (!hasOut && !hasIn) err(c.file, 'orphan concept: no related and no backlink');
}

// ---------- Data folders: naming and previews ----------
// A YAML file that does not parse breaks the site build, so it fails here instead.
const dataFiles = (sub: string) => {
  const dir = path.join(ROOT, sub);
  if (!fs.existsSync(dir)) return [] as string[];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
};

for (const f of dataFiles('naming')) {
  let d: Record<string, unknown>;
  try {
    d = yaml.load(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    err(f, `YAML non valido: ${(e as Error).message.split('\n')[0]}`);
    continue;
  }
  const base = path.basename(f).replace(/\.ya?ml$/, '');
  if (d?.id !== base) err(f, `id "${d?.id}" diverso dal nome file "${base}"`);
  for (const k of ['current', 'changed']) if (!d?.[k]) err(f, `missing "${k}"`);
  if (typeof d?.changed === 'string' && !/^\d{4}(-\d{2}){0,2}$/.test(d.changed)) err(f, `changed deve essere YYYY, YYYY-MM o YYYY-MM-DD`);
  const trail = (d?.trail ?? []) as { name?: string }[];
  if (trail.length < 2) err(f, 'trail deve avere almeno il nome vecchio e quello attuale');
  if (trail.length && trail[trail.length - 1]?.name !== d?.current) err(f, `l'ultimo nome nel trail deve essere "${d?.current}"`);
  for (const id of (d?.concepts ?? []) as string[]) if (!conceptIds.has(id)) err(f, `concepts: "${id}" non esiste`);
  if (d?.area && !areaById.has(String(d.area))) err(f, `area "${d.area}" non esiste`);
}

for (const f of dataFiles('previews')) {
  let d: Record<string, unknown>;
  try {
    d = yaml.load(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    err(f, `YAML non valido: ${(e as Error).message.split('\n')[0]}`);
    continue;
  }
  const base = path.basename(f).replace(/\.ya?ml$/, '');
  if (d?.id !== base) err(f, `id "${d?.id}" diverso dal nome file "${base}"`);
  for (const k of ['name', 'label', 'area', 'summary', 'url']) if (!d?.[k]) err(f, `missing "${k}"`);
  if (d?.label && !['public-preview', 'beta', 'private-preview'].includes(String(d.label)))
    err(f, `label non valida: ${d.label}`);
  if (d?.area && !areaById.has(String(d.area))) err(f, `area "${d.area}" non esiste`);
  if (d?.concept && !conceptIds.has(String(d.concept))) err(f, `concept "${d.concept}" non esiste`);
}

// ---------- Report ----------
for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
console.log(
  `\n${concepts.length} concepts, ${areas.length} areas, ${paths.length} paths, ${roadmaps.length} roadmaps, ${snippets.size} snippets — ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
