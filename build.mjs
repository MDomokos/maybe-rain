// build.mjs — produce a minified copy of the site in ./dist
//
// The repo is split into modules for editing. The published site is not.
// Each variant (primary/, classic/) is a thin visual layer over the shared
// core in shared/, wired together at dev time by ordinary <script src>
// tags. This script resolves those tags into a single inline <script> per
// variant BEFORE minifying, so what ships is what shipped before the split:
// one self-contained HTML file per variant, no extra requests, SW-cacheable
// as a single shell. shared/ is never published as files.
//
// Layout in → out:
//   primary/*        →  dist/            (the redesign; existing bookmarks)
//   classic/*        →  dist/classic/    (the frozen feature-complete variant)
//   primary/* + eink →  dist/eink/       (primary with the e-ink overlay)
//   shared/*.js      →  inlined into both, never emitted
//   root assets      →  copied into BOTH dist/ and dist/classic/, so each
//                       variant is self-contained under its own SW scope
//
// What it does per file:
//   *.html          inline scripts, strip comments + whitespace, minify CSS/JS
//   *.js            terser (compress + mangle)          [e.g. sw.js]
//   *.json          re-serialize with no whitespace     [e.g. manifest.json]
//   *.svg           svgo                                 [e.g. favicon.svg]
//   everything else copied byte-for-byte                 [png icons, LICENSE, ...]
//
// Working docs and tooling are never published (see SKIP below).
// Run: npm run build

import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { join, extname, relative, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
// Named imports, not the `process` global: this module declares a function
// called `process` (see below), which shadows it at module scope. That is
// what made the failure path at the bottom throw a TypeError instead of
// exiting 1.
import { argv, exit } from 'node:process';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import { optimize as optimizeSvg } from 'svgo';

const SRC = fileURLToPath(new URL('.', import.meta.url)); // repo root = this script's dir
const OUT = join(SRC, 'dist');

// Each variant owns its own sw.js, so it owns its own build id. VERSION is
// read per variant from that file's CACHE_NAME and substituted for every
// __APP_VERSION__ token in the variant's HTML and in the shared modules
// inlined into it. The app still learns its version from one source; there
// is now one such source per variant.
const VARIANTS = [
  { dir: 'primary', dest: '.' },
  { dir: 'classic', dest: 'classic' },
  { dir: 'primary', dest: 'eink', patch: (rel, text) => einkPatch(rel, text) },
];

// --- the e-ink build -------------------------------------------------------
// Primary's own sources with eink/ spliced in at build time, so it gets every
// primary change and primary ships none of its bytes. Each splice asserts its
// anchor, so a primary edit that moves one fails the build instead of quietly
// shipping an e-ink page without its overlay.
//
// sw.js gets its own cache prefix: cache storage is per-origin, and sharing
// primary's would let either variant's activate sweep delete the other's shell.
const EINK_CSS = await readFile(join(SRC, 'eink', 'eink.css'), 'utf8');
const splice = (text, anchor, insert, rel) => {
  if (text.split(anchor).length !== 2) throw new Error(`eink: ${rel} lost its anchor ${anchor}`);
  return text.replace(anchor, insert);
};
function einkPatch(rel, text) {
  if (rel === 'index.html') {
    text = splice(text, '</head>', `<style>\n${EINK_CSS}</style>\n</head>`, rel);
    return splice(text, '<script src="config.js"></script>',
      '<script src="../eink/eink.js"></script>\n    <script src="config.js"></script>', rel);
  }
  if (rel === 'sw.js') return splice(text, "CACHE_PREFIX = 'maybe-rain-2.'", "CACHE_PREFIX = 'maybe-rain-e2.'", rel);
  return text;
}

// Directories walk() never descends into. The variant dirs and shared/ are
// here because they are built explicitly below, not swept up as root assets.
const SKIP_DIRS = new Set([
  '.git', '.github', 'node_modules', 'dist', 'research', 'archive', 'scripts',
  'shared', 'eink', ...VARIANTS.map(v => v.dir),
]);
// Files we never publish (tooling + local-only working docs + junk).
const SKIP_FILES = new Set([
  '.DS_Store', '.gitignore', 'build.mjs', 'package.json', 'package-lock.json',
  'README.md', 'SPEC.md', 'SPEC-ARCHIVE.md', 'DEPLOY.md', 'NATIVE-FEEL.md',
  'BEHAVIOR.md', 'Logo.afdesign', 'tag.txt',
]);
// BEHAVIOR.md is matched by basename, so the one entry covers both
// primary/BEHAVIOR.md and classic/BEHAVIOR.md. CHANGELOG.md is deliberately
// NOT here: the What's new modal reads it at runtime, so it ships.

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
const gz = (buf) => gzipSync(buf, { level: 9 }).length;

// --- the sizes quoted in README.md ---------------------------------------
// A hand-written size is stale one release after it is written, so the README
// takes its numbers from this build, between markers, and the rest of the
// file stays hand-edited. The shell and its service worker are what a visit
// downloads, so those are the figures; the published total (both variants,
// the explainer, the icons) stays in this script's own table.
//
// Written as a GitHub alert (`> [!TIP]`), which renders as a callout there
// and as an ordinary blockquote everywhere else.
//
// `node build.mjs --check` reports instead of writing, and exits 1 when the
// README does not match this build.
const README = join(SRC, 'README.md');
const SIZE_START = '<!-- sizes: generated by npm run build -->';
const SIZE_END = '<!-- /sizes -->';
const CHECK_ONLY = argv.includes('--check');

const sizeBlock = () => {
  const shell = rows.find((r) => r.rel === 'index.html');
  const sw = rows.find((r) => r.rel === 'sw.js');
  if (!shell || !sw) return null;   // a layout change: say nothing rather than guess
  return [
    SIZE_START,
    '> [!TIP]',
    `> **The whole app is one HTML file: ${kb(shell.gzMin)} over the wire.**`,
    // A bare `>` keeps the detail in its own paragraph inside the callout;
    // consecutive lines would join into the headline.
    '>',
    `> ${kb(shell.min)} minified, gzipped to ${kb(shell.gzMin)}, plus a ${kb(sw.min)} service `
      + `worker (${kb(sw.gzMin)} gzipped).`,
    SIZE_END,
  ].join('\n');
};

// Returns false only when `--check` found the README out of date.
async function writeSizes() {
  let readme;
  try { readme = await readFile(README, 'utf8'); }
  catch { console.log('  no README.md here; sizes not written'); return true; }
  const a = readme.indexOf(SIZE_START), b = readme.indexOf(SIZE_END);
  if (a < 0 || b < a) {
    console.log(`  README.md has no ${SIZE_START} block; sizes not written`);
    return true;
  }
  const block = sizeBlock();
  if (!block) { console.log('  dist/ has no index.html + sw.js; sizes not written'); return true; }
  const next = readme.slice(0, a) + block + readme.slice(b + SIZE_END.length);
  if (next === readme) { console.log('  README sizes: current'); return true; }
  if (CHECK_ONLY) {
    console.error('  README sizes are out of date. Run `npm run build` and commit README.md.');
    console.error(block.split('\n').slice(1, -1).map((l) => '    want: ' + l).join('\n'));
    return false;
  }
  await writeFile(README, next);
  console.log('  README sizes: updated');
  return true;
}

// A dev-time <script src="..."></script> line, including its indentation and
// trailing newline so removing it leaves no blank line behind.
const scriptTag = () => /[ \t]*<script src="([^"]+)"><\/script>[ \t]*\n?/g;

// Resolve every <script src> in `html` against `dir`, concatenate the files
// in document order, and splice them back in as one inline <script> at the
// position of the first tag.
//
// The bundle is wrapped in an IIFE for a measurable reason. The app is one
// flat lexical scope by design, and at top level terser must preserve every
// name, because something outside could reference it. Inside a function
// scope it can mangle all of them, which is worth about 10% of the gzipped
// script. That is safe here because nothing external reaches in by NAME:
// there are no inline on* handlers in the markup and the docs iframe never
// touches its parent.
//
// app.js does assign `window.MR` for the on-demand explainer. The export is an
// object whose property names terser keeps, so the mangled locals behind them
// are never named from outside. An inline on* handler, or an internal name
// read back off window, is what would force this wrapper to go.
async function inlineScripts(html, dir) {
  const hits = [...html.matchAll(scriptTag())];
  if (!hits.length) return { html, files: [] };

  const parts = [];
  for (const [, src] of hits) {
    const path = resolve(dir, src);
    parts.push(`// ─── ${relative(SRC, path)} ` + '─'.repeat(Math.max(0, 56 - src.length)));
    parts.push(await readFile(path, 'utf8'));
  }
  const bundle = `<script>\n(() => {\n${parts.join('\n')}\n})();\n</script>\n`;

  const MARK = ' __BUNDLE__ ';
  const at = hits[0].index;
  let out = html.slice(0, at) + MARK + html.slice(at);
  out = out.replace(scriptTag(), '');
  return { html: out.replace(MARK, bundle), files: hits.map(h => h[1]) };
}

async function process(srcPath, destPath, version, patch = (rel, text) => text) {
  await mkdir(dirname(destPath), { recursive: true });

  const rel = relative(OUT, destPath);
  const ext = extname(srcPath).toLowerCase();
  const orig = (await stat(srcPath)).size;
  let out;      // minified bytes if we transformed it
  let inlined = 0;

  try {
    if (ext === '.html') {
      let html = patch(basename(srcPath), await readFile(srcPath, 'utf8'));
      const res = await inlineScripts(html, dirname(srcPath));
      inlined = res.files.length;
      // Substitute AFTER inlining so the token is replaced in the shared
      // modules too, not just in the page's own markup.
      out = await minifyHtml(res.html.replaceAll('__APP_VERSION__', version), HTML_OPTS);
    } else if (ext === '.js') {
      const src = patch(basename(srcPath), await readFile(srcPath, 'utf8')).replaceAll('__APP_VERSION__', version);
      out = (await minifyJs(src, { compress: true, mangle: true })).code;
    } else if (ext === '.css') {
      // A stylesheet not inlined into a page: primary/explain.css. Wrapping it
      // in a <style> runs html-minifier-terser's own CSS pass over it, rather
      // than adding a second minifier for one file.
      const css = await readFile(srcPath, 'utf8');
      out = (await minifyHtml(`<style>${css}</style>`, { minifyCSS: true, collapseWhitespace: true }))
        .replace(/^<style>|<\/style>$/g, '');
    } else if (ext === '.json') {
      out = JSON.stringify(JSON.parse(await readFile(srcPath, 'utf8')));
    } else if (ext === '.svg') {
      out = optimizeSvg(await readFile(srcPath, 'utf8'), { multipass: true }).data;
    }
  } catch (err) {
    console.error(`\n  ✗ failed to build ${rel}: ${err.message}`);
    throw err;
  }

  if (out != null) {
    await writeFile(destPath, out);
    rows.push({
      rel, orig, min: Buffer.byteLength(out), inlined,
      gzOrig: gz(await readFile(srcPath)), gzMin: gz(Buffer.from(out)),
    });
  } else {
    await copyFile(srcPath, destPath); // binary / unknown: passthrough
    rows.push({ rel, orig, min: orig, gzOrig: null, gzMin: null, copied: true });
  }
}

// Collect every publishable file under `dir`, as paths relative to `dir`.
async function collect(dir, base = dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collect(join(dir, entry.name), base, acc);
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      acc.push(relative(base, join(dir, entry.name)));
    }
  }
  return acc;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Root-level shared assets (icons, favicon, og image, the docs page,
  // LICENSE). Copied into every variant rather than referenced across
  // directories, so each variant resolves its own relative paths unchanged
  // and its own SW scope covers everything it asks for.
  const assets = await collect(SRC);

  for (const v of VARIANTS) {
    const from = join(SRC, v.dir);
    const to = join(OUT, v.dest);
    const swSrc = (v.patch || ((rel, text) => text))('sw.js', await readFile(join(from, 'sw.js'), 'utf8'));
    const version = (swSrc.match(/CACHE_NAME\s*=\s*(?:CACHE_PREFIX\s*\+\s*)?['"]([^'"]+)['"]/) || [])[1];
    if (!version) throw new Error(`${v.dir}/sw.js: no CACHE_NAME found`);
    const prefix = (swSrc.match(/CACHE_PREFIX\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    const build = prefix + version;

    const files = await collect(from);

    // Anything a page inlines is a dev-time source file. Emitting it as well
    // would add back the requests this whole arrangement exists to avoid, so
    // it is skipped. The set is worked out from the pages themselves rather
    // than named here, so adding a module to a variant needs no build edit.
    const inlined = new Set();
    for (const rel of files.filter(f => extname(f) === '.html')) {
      const html = await readFile(join(from, rel), 'utf8');
      for (const [, src] of html.matchAll(scriptTag())) {
        inlined.add(resolve(dirname(join(from, rel)), src));
      }
    }

    console.log(`\n  ${v.dir} → dist/${v.dest === '.' ? '' : v.dest + '/'}   build id ${build}`);

    for (const rel of files) {
      if (inlined.has(resolve(from, rel))) continue;
      await process(join(from, rel), join(to, rel), build, v.patch);
    }
    for (const rel of assets) {
      await process(join(SRC, rel), join(to, rel), build);
    }
  }

  await writeFile(join(OUT, '.nojekyll'), ''); // stop GitHub Pages running Jekyll

  rows.sort((a, b) => b.orig - a.orig);
  let to = 0, tm = 0, tgo = 0, tgm = 0;
  console.log('\n  minified → dist/\n');
  console.log('  ' + 'file'.padEnd(38) + 'raw'.padStart(9) + 'min'.padStart(9) + 'gz'.padStart(9));
  for (const r of rows) {
    to += r.orig; tm += r.min;
    const gzShown = r.gzMin != null ? kb(r.gzMin) : '—';
    if (r.gzOrig != null) { tgo += r.gzOrig; tgm += r.gzMin; }
    const tag = r.copied ? ' (copied)' : (r.inlined ? ` (+${r.inlined} inlined)` : '');
    console.log('  ' + (r.rel + tag).padEnd(38) + kb(r.orig).padStart(9) + kb(r.min).padStart(9) + gzShown.padStart(9));
  }
  console.log('  ' + '─'.repeat(65));
  console.log('  ' + 'total'.padEnd(38) + kb(to).padStart(9) + kb(tm).padStart(9) + kb(tgm).padStart(9));
  // Signed once: the inlined shell can gzip LARGER than the sum of the source
  // files it replaces, and the old form printed that as "−-4%".
  const pct = (a, b) => {
    if (!a) return '±0%';
    const d = ((1 - b / a) * 100).toFixed(0);
    return (d > 0 ? '−' : d < 0 ? '+' : '±') + Math.abs(d) + '%';
  };
  console.log(`\n  raw:  ${kb(to)} → ${kb(tm)}  (${pct(to, tm)})`);
  console.log(`  text assets gzipped: ${kb(tgo)} → ${kb(tgm)}  (${pct(tgo, tgm)}, this is what ships over the wire)`);
  const sizesOk = await writeSizes();
  console.log('');
  if (!sizesOk) exit(1);
}

main().catch((e) => { console.error(e); exit(1); });
