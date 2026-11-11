// Packs the tracker sources (tracker-src/) into one JSON file that the admin
// publishes from the tracker's "Manage access" screen. The published copy
// lives in Firestore and is only readable by approved people; the sources in
// tracker-src/ are never put on the website.
//
//   node tools/build-tracker.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tracker-src');
const page = readFileSync(join(root, 'index.html'), 'utf8');
const css = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>'));
const html = page.slice(page.indexOf('<body>') + 6, page.indexOf('<script type="module"'));

const files = {};
for (const f of readdirSync(join(root, 'js'))) if (f.endsWith('.js')) files[f] = readFileSync(join(root, 'js', f), 'utf8');

// Load order: every module after the modules it imports.
const deps = (src) => [...src.matchAll(/from\s+['"]\.\/([\w.-]+\.js)['"]/g)].map((m) => m[1]);
const order = [], seen = new Set();
const visit = (f) => {
  if (seen.has(f)) return;
  seen.add(f);
  if (!files[f]) throw new Error(`missing module ${f}`);
  deps(files[f]).forEach(visit);
  order.push(f);
};
visit('app.js');

const body = { css, html, files: Object.fromEntries(order.map((f) => [f, files[f]])), order };
const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 8);
const bundle = { version: `${new Date().toISOString().slice(0, 10)}-${hash}`, ...body };
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'tracker.bundle.json');
writeFileSync(out, JSON.stringify(bundle));
console.log(`wrote ${out}  version ${bundle.version}  ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB  modules: ${order.join(', ')}`);
