/*
 * check-paths.js — every file the app and its checks name, found where they name it.
 *   node tools/check-paths.js
 * Fails (exit 1) when a reference points to a file that is not there, or a script or style sits loose at the top
 * level instead of in its folder (README.md has the folder map). What it follows:
 *   the page's <script src> and <link href>;  styles' url(...);  loadScript('...') (from the page's folder);
 *   makeWorker('x.js') (workers/x.js);  a worker's importScripts(...);  require('./...') and require('../...');
 *   the lazy loaders FPL_/FPT_(name, './x.js');  path.join(__dirname, '...', ...) up to its first non-literal part.
 * It also lists scripts that nothing loads (a note, not a failure).
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGE = 'Blade Coat Defect Lab.html';
const FOLDERS = ['app', 'pages', 'engine', 'workers', 'checks', 'tools', 'benchmarks'];
const SKIP = new Set(['workers/workers-src.js', 'tools/check-paths.js']);   // generated (the workers' scripts as text); this file's own examples

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const bad = [], used = new Set();
function want(from, target, how) {
  const t = path.resolve(target);
  if (!fs.existsSync(t)) bad.push(`${from}: ${how} -> ${rel(t)} is not there`);
  else used.add(rel(t));
}
function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'results' && e.name !== 'node_modules') out.push(...jsFiles(p)); }
    else if (e.name.endsWith('.js') && !SKIP.has(p)) out.push(p);
  }
  return out;
}
const lit = s => { const m = /^\s*(['"])([^'"]*)\1\s*$/.exec(s); return m ? m[2] : null; };
/** The arguments of a call, split at top-level commas (enough for the literal calls followed here). */
function args(text, open) {
  let depth = 0, cur = '', out = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') { if (depth++ > 0) cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { if (--depth === 0) { out.push(cur); return out; } cur += c; continue; }
    if (c === ',' && depth === 1) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  return out;
}

// 1. the page: scripts and styles, in the order it loads them
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) want(PAGE, path.join(ROOT, decodeURI(m[1])), `<script src="${m[1]}">`);
for (const m of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) {
  if (/^(data:|https?:|#)/.test(m[1])) continue;
  want(PAGE, path.join(ROOT, decodeURI(m[1])), `<link href="${m[1]}">`);
}
// 2. styles: fonts and images by url(...)
for (const css of ['app/styles.css']) {
  const t = fs.readFileSync(path.join(ROOT, css), 'utf8');
  for (const m of t.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (/^(data:|https?:|#)/.test(m[1])) continue;
    want(css, path.join(ROOT, path.dirname(css), m[1]), `url(${m[1]})`);
  }
}
// 3. scripts: workers, imports, requires, files read beside them
const all = FOLDERS.flatMap(jsFiles);
for (const f of all) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8'), dir = path.join(ROOT, path.dirname(f));
  for (const m of t.matchAll(/loadScript\(\s*'([^']+)'/g)) want(f, path.join(ROOT, m[1]), `loadScript('${m[1]}')`);
  for (const m of t.matchAll(/makeWorker\(\s*'([^']+)'/g)) want(f, path.join(ROOT, 'workers', m[1]), `makeWorker('${m[1]}')`);
  for (const m of t.matchAll(/\bimportScripts\(/g))
    for (const a of args(t, m.index + m[0].length - 1)) { const s = lit(a); if (s) want(f, path.join(dir, s), `importScripts('${s}')`); }
  for (const m of t.matchAll(/\brequire\(\s*'(\.\.?\/[^']+)'\s*\)/g)) want(f, path.join(dir, m[1]), `require('${m[1]}')`);
  for (const m of t.matchAll(/\bFP[LT]_\(\s*'[^']+'\s*,\s*'(\.\.?\/[^']+)'\s*\)/g)) want(f, path.join(dir, m[1]), `lazy require '${m[1]}'`);
  for (const m of t.matchAll(/\.join\(\s*__dirname\s*,/g)) {
    const parts = [];
    for (const a of args(t, m.index + m[0].indexOf('('))) { const s = lit(a); if (a.trim() === '__dirname') continue; if (s === null) break; parts.push(s); }
    if (parts.length) want(f, path.join(dir, ...parts), `path.join(__dirname, ${parts.map(p => `'${p}'`).join(', ')})`);
  }
}
// 4. nothing loose at the top: scripts and styles live in their folders
for (const e of fs.readdirSync(ROOT)) if (/\.(js|css)$/.test(e)) bad.push(`${e}: at the top level; put it in its folder (README.md)`);

// 5. scripts nothing loads (a note): app, pages and engine scripts the page, a worker or a script does not name
const loose = all.filter(f => /^(app|pages|engine)\//.test(f) && !used.has(f));

if (bad.length) { console.error(bad.join('\n') + `\n${bad.length} broken path${bad.length > 1 ? 's' : ''}`); process.exit(1); }
console.log(`paths OK: ${used.size} files named, all there (${all.length} scripts read)`);
if (loose.length) console.log(`note: not loaded by anything: ${loose.join(', ')}`);
