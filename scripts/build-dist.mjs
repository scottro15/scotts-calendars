#!/usr/bin/env node
// Speed step A (t182u): minified copies of the app files in dist/, same file names, with source maps.
//   dist/app.js     = the startup files of scripts/app-files.txt, in order, as ONE classic script (globals unchanged;
//                     each file is separated by ";" so no file can run into the next one), minified, keep-names.
//   dist/early.js, dist/styles.css, dist/tablet.css = minified copies.
// Step B: files listed in scripts/lazy-chunks.json are left out of dist/app.js and built as dist/<chunk>.js; lazy.js
//   loads them after startup / on first use. index.html gets window.__lazyFiles (chunk -> urls) between the markers.
//   dist/app-all.js = every file (the step A single bundle), used by --eager.
// The maps point at the original files (line level), so DevTools shows real file names.
//
//   node scripts/build-dist.mjs          build dist/ and switch index.html + sw.js to it, lazy chunks on  (ON)
//   node scripts/build-dist.mjs --eager  dist/, but everything in one startup bundle (ROLLBACK of step B)
//   node scripts/build-dist.mjs --off    the plain files, everything at startup (ROLLBACK of steps A + B; dist/ left alone)
//   node scripts/build-dist.mjs --check  fail if dist/ is out of date with the sources (run before every release)
// esbuild: set ESBUILD_PATH to an esbuild package dir, or `npm i esbuild@0.25` somewhere on NODE_PATH.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FILES = rd('scripts/app-files.txt').split('\n').map(s => s.trim()).filter(Boolean);
const CHUNKS = JSON.parse(rd('scripts/lazy-chunks.json'));
const LAZY = new Set(Object.values(CHUNKS).flat());
for (const f of LAZY) if (!FILES.includes(f)) throw new Error(`lazy-chunks.json: ${f} is not in app-files.txt`);
const CORE = FILES.filter(f => !LAZY.has(f));
const mode = process.argv[2] || 'on';
const req = createRequire(import.meta.url);
const esbuild = (() => { for (const p of [process.env.ESBUILD_PATH, 'esbuild', '/workspace/.buildtools/node_modules/esbuild']) { if (!p) continue; try { return req(p); } catch (_) {} } return null; })();

// ---------- index.html + sw.js switching ----------
function setIndex(how) { // 'lazy' | 'eager' | 'off'
  let h = rd('index.html'); const tag = (h.match(/styles\.css\?v=([\w.-]+)/) || [])[1] || 'dev';
  const A = '<!-- app-scripts:start (scripts/build-dist.mjs) -->', B = '<!-- app-scripts:end -->';
  const dist = how !== 'off';
  const lazyMap = how === 'lazy' ? Object.fromEntries(Object.keys(CHUNKS).map(c => [c, [`dist/${c}.js?v=${tag}`]])) : {};
  const map = `  <script>window.__lazyFiles = ${JSON.stringify(lazyMap)};</script>\n`;
  const tags = how === 'lazy' ? `  <script src="dist/early.js?v=${tag}"></script>\n` + VENDOR + map + `  <script src="dist/app.js?v=${tag}"></script>\n`
    : how === 'eager' ? `  <script src="dist/early.js?v=${tag}"></script>\n` + VENDOR + map + `  <script src="dist/app-all.js?v=${tag}"></script>\n`
    : `  <script src="early.js?v=${tag}"></script>\n` + VENDOR + map + FILES.map(f => `  <script src="${f}?v=${tag}"></script>\n`).join('');
  const i = h.indexOf(A), j = h.indexOf(B); if (i < 0 || j < 0) throw new Error('index.html: app-scripts markers missing');
  h = h.slice(0, i + A.length) + '\n' + tags + '  ' + h.slice(j);
  h = h.replace(/href="(?:dist\/)?(styles|tablet)\.css\?v=/g, (m, n) => `href="${dist ? 'dist/' : ''}${n}.css?v=`);
  fs.writeFileSync(path.join(ROOT, 'index.html'), h);
  let s = rd('sw.js'); const SA = '/* shell-files:start */', SB = '/* shell-files:end */';
  const list = how === 'lazy' ? ['dist/styles.css', 'dist/tablet.css', 'dist/early.js', 'dist/app.js', ...Object.keys(CHUNKS).map(c => `dist/${c}.js`)]
    : how === 'eager' ? ['dist/styles.css', 'dist/tablet.css', 'dist/early.js', 'dist/app-all.js'] : ['styles.css', 'tablet.css', 'early.js', ...FILES];
  const a = s.indexOf(SA), b = s.indexOf(SB); if (a < 0 || b < 0) throw new Error('sw.js: shell-files markers missing');
  s = s.slice(0, a + SA.length) + ' ' + list.map(f => `'${f}'`).join(', ') + ' ' + s.slice(b);
  fs.writeFileSync(path.join(ROOT, 'sw.js'), s);
}
const VENDOR = '  <script src="vendor/fullcalendar.min.js"></script>\n  <script src="vendor/supabase.min.js"></script>\n';

// ---------- build ----------
function lineMap(srcs) { // input map for the joined file: each generated line -> same line, column 0, of its source file
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = n => { let v = n < 0 ? ((-n) << 1) | 1 : n << 1, o = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; o += B64[d]; } while (v); return o; };
  const lines = []; let ps = 0, pl = 0;
  srcs.forEach(({ text }, si) => { const n = text.split('\n').length; for (let l = 0; l < n; l++) { lines.push(vlq(0) + vlq(si - ps) + vlq(l - pl) + vlq(0)); ps = si; pl = l; } lines.push(''); });
  return { version: 3, sources: srcs.map(s => '../' + s.f), sourcesContent: srcs.map(s => s.text), names: [], mappings: lines.join(';') };
}
async function bundle(files, name, opt) { // files joined in order -> dist/<name>.js + map
  const srcs = files.map(f => ({ f, text: rd(f) }));
  const joined = srcs.map(s => s.text).join('\n;\n'); // ";" between files: a file without a trailing semicolon can't merge into the next
  const r = await esbuild.transform(joined + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(lineMap(srcs))).toString('base64'),
    { ...opt, loader: 'js', sourcemap: 'external', sourcefile: name + '.joined.js' });
  return { [`dist/${name}.js`]: r.code + `//# sourceMappingURL=${name}.js.map\n`, [`dist/${name}.js.map`]: r.map };
}
async function build() {
  if (!esbuild) throw new Error('esbuild not found (set ESBUILD_PATH)');
  const opt = { minify: true, keepNames: true, legalComments: 'none', target: 'es2020', charset: 'utf8' };
  const out = { ...(await bundle(CORE, 'app', opt)), ...(await bundle(FILES, 'app-all', opt)) };
  for (const [c, files] of Object.entries(CHUNKS)) Object.assign(out, await bundle(FILES.filter(f => files.includes(f)), c, opt)); // app-files order
  for (const [f, loader] of [['early.js', 'js'], ['styles.css', 'css'], ['tablet.css', 'css']]) {
    const t = await esbuild.transform(rd(f), { ...opt, loader, sourcemap: 'external', sourcefile: '../' + f, ...(loader === 'css' ? { keepNames: undefined, target: ['safari15', 'chrome100'] } : {}) });
    out['dist/' + f] = t.code + (loader === 'css' ? `/*# sourceMappingURL=${f}.map */\n` : `//# sourceMappingURL=${f}.map\n`); out[`dist/${f}.map`] = t.map;
  }
  return out;
}
const main = async () => {
  if (mode === '--off') { setIndex('off'); console.log('dist OFF: index.html + sw.js now load the plain files, all at startup'); return; }
  const out = await build();
  if (mode === '--check') {
    const stale = Object.entries(out).filter(([f, c]) => !fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), 'utf8') !== c).map(([f]) => f);
    if (stale.length) { console.error('dist/ is stale: ' + stale.join(', ') + '  -> run node scripts/build-dist.mjs'); process.exit(1); }
    console.log('dist/ up to date'); return;
  }
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  for (const [f, c] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, f), c);
  const how = mode === '--eager' ? 'eager' : 'lazy'; setIndex(how);
  const kb = f => (Buffer.byteLength(out[f]) / 1024).toFixed(1) + ' KB';
  if (how === 'eager') console.log(`dist ON, EAGER: app-all.js ${kb('dist/app-all.js')} (all ${FILES.length} files at startup)`);
  else console.log(`dist ON, LAZY: app.js ${kb('dist/app.js')} (${CORE.length} startup files), ` + Object.keys(CHUNKS).map(c => `${c}.js ${kb(`dist/${c}.js`)}`).join(', ') + `, early.js ${kb('dist/early.js')}, styles.css ${kb('dist/styles.css')}, tablet.css ${kb('dist/tablet.css')}`);
};
main().catch(e => { console.error(e.message); process.exit(1); });
