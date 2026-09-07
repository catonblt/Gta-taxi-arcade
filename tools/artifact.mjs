// Packs the production build into one self-contained HTML fragment for publishing as an Artifact,
// so the game can be opened and played on a phone from a URL. Artifacts supply their own
// doctype/head/charset/viewport, so this emits only what index.html adds on top of that.
//
// The single-file host cannot serve public/manifest.webmanifest or public/icons/*.png as separate
// files, so a plain <link rel="apple-touch-icon" href="./icons/..."> would 404 there — the icon
// would silently fail and iOS would fall back to a generic home-screen tile. The touch icon is
// therefore inlined as a real PNG data URI. The manifest.webmanifest link is dropped for this
// build only: it would 404 the same way, and standalone/full-screen launch on iOS is already
// carried by the apple-mobile-web-app-capable meta tag below, which needs no external file.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const html = await readFile(new URL('index.html', dist), 'utf8');

const assets = await readdir(new URL('assets/', dist));
const jsName = assets.find((f) => f.endsWith('.js'));
if (!jsName) throw new Error('no bundle found in dist/assets');
const js = await readFile(new URL(`assets/${jsName}`, dist), 'utf8');

const pick = (re) => (html.match(re) ?? []).join('\n');
const fontLinks = pick(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g);
// Meta tags the Artifact host's own head skeleton does not already supply (it only adds
// charset and viewport) — everything iOS/Android need to treat this as an installable app.
const appMeta = pick(
  /<meta name="(?:theme-color|mobile-web-app-capable|apple-mobile-web-app-capable|apple-mobile-web-app-title|apple-mobile-web-app-status-bar-style)"[^>]*>/g,
);
const favicon = pick(/<link rel="icon"[^>]*>/g);
const style = pick(/<style>[\s\S]*?<\/style>/g);
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const touchIconPng = await readFile(new URL('public/icons/icon-180.png', root));
const touchIcon = `<link rel="apple-touch-icon" href="data:image/png;base64,${touchIconPng.toString('base64')}" />`;

const out = `${appMeta}
${favicon}
${touchIcon}
${fontLinks}
<title>Getaway</title>
${style}
${body}
<script type="module">
${js}
</script>
`;

await mkdir(new URL('artifact/', root), { recursive: true });
await writeFile(new URL('artifact/getaway.html', root), out);
console.log(`artifact/getaway.html — ${(out.length / 1024).toFixed(1)} kB`);
