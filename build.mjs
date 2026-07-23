// build.mjs — produce a minified copy of the site in ./dist
//
// What it does:
//   *.html          strip comments + whitespace, minify inline CSS and inline JS
//   *.js            terser (compress + mangle)          [e.g. sw.js]
//   *.json          re-serialize with no whitespace     [e.g. manifest.json]
//   *.svg           svgo                                 [e.g. favicon.svg]
//   everything else copied byte-for-byte                 [png icons, LICENSE, ...]
//
// Working docs and tooling are never published (see SKIP below).
// Output is a self-contained ./dist ready to serve at the /maybe-rain/ subpath.
// Run: npm run build

import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import { optimize as optimizeSvg } from 'svgo';

const SRC = fileURLToPath(new URL('.', import.meta.url)); // repo root = this script's dir
const OUT = join(SRC, 'dist');

// The build id, read from sw.js's CACHE_NAME and injected into index.html
// (every __APP_VERSION__ token) so the app knows its own version from one source.
let VERSION = 'dev';

// Directories we never descend into.
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'dist', 'research', 'archive']);
// Files we never publish (tooling + local-only working docs + junk).
const SKIP_FILES = new Set([
  '.DS_Store', '.gitignore', 'build.mjs', 'package.json', 'package-lock.json',
  'README.md', 'SPEC.md', 'DEPLOY.md', 'NATIVE-FEEL.md', 'Logo.afdesign',
]);

const HTML_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyCSS: true,
  minifyJS: true,
};

const rows = [];
const kb = (n) => (n / 1024).toFixed(1) + 'kb';

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      await process(join(dir, entry.name));
    }
  }
}

async function process(srcPath) {
  const rel = relative(SRC, srcPath);
  const dest = join(OUT, rel);
  await mkdir(join(dest, '..'), { recursive: true });

  const ext = extname(srcPath).toLowerCase();
  const orig = (await stat(srcPath)).size;
  let out; // minified bytes (Buffer or string) if we transformed it

  try {
    if (ext === '.html') {
      const html = (await readFile(srcPath, 'utf8')).replaceAll('__APP_VERSION__', VERSION);
      out = await minifyHtml(html, HTML_OPTS);
    } else if (ext === '.js') {
      const res = await minifyJs(await readFile(srcPath, 'utf8'), { compress: true, mangle: true });
      out = res.code;
    } else if (ext === '.json') {
      out = JSON.stringify(JSON.parse(await readFile(srcPath, 'utf8')));
    } else if (ext === '.svg') {
      out = optimizeSvg(await readFile(srcPath, 'utf8'), { multipass: true }).data;
    }
  } catch (err) {
    console.error(`\n  ✗ failed to minify ${rel}: ${err.message}`);
    throw err;
  }

  if (out != null) {
    await writeFile(dest, out);
    const min = Buffer.byteLength(out);
    rows.push({ rel, orig, min, gzOrig: gz(await readFile(srcPath)), gzMin: gz(Buffer.from(out)) });
  } else {
    await copyFile(srcPath, dest); // binary / unknown: passthrough
    rows.push({ rel, orig, min: orig, gzOrig: null, gzMin: null, copied: true });
  }
}

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

async function main() {
  const swSrc = await readFile(join(SRC, 'sw.js'), 'utf8');
  VERSION = (swSrc.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1] || 'dev';
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await walk(SRC);
  await writeFile(join(OUT, '.nojekyll'), ''); // stop GitHub Pages running Jekyll

  rows.sort((a, b) => b.orig - a.orig);
  let to = 0, tm = 0, tgo = 0, tgm = 0;
  console.log('\n  minified → dist/\n');
  console.log('  ' + 'file'.padEnd(34) + 'raw'.padStart(9) + 'min'.padStart(9) + 'gz'.padStart(9));
  for (const r of rows) {
    to += r.orig; tm += r.min;
    const gzShown = r.gzMin != null ? kb(r.gzMin) : '—';
    if (r.gzOrig != null) { tgo += r.gzOrig; tgm += r.gzMin; }
    const tag = r.copied ? ' (copied)' : '';
    console.log('  ' + (r.rel + tag).padEnd(34) + kb(r.orig).padStart(9) + kb(r.min).padStart(9) + gzShown.padStart(9));
  }
  console.log('  ' + '─'.repeat(61));
  console.log('  ' + 'total'.padEnd(34) + kb(to).padStart(9) + kb(tm).padStart(9) + kb(tgm).padStart(9));
  const pct = (a, b) => (a ? ((1 - b / a) * 100).toFixed(0) : '0');
  console.log(`\n  raw:  ${kb(to)} → ${kb(tm)}  (−${pct(to, tm)}%)`);
  console.log(`  text assets gzipped: ${kb(tgo)} → ${kb(tgm)}  (−${pct(tgo, tgm)}%, this is what ships over the wire)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
