// Packs the production build into one self-contained HTML fragment for publishing as an Artifact,
// so the game can be opened and played on a phone from a URL. Artifacts supply their own
// doctype/head/body, so this emits only <link>/<title>/<style>/markup/<script>.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');

const assets = await readdir(new URL('assets/', dist));
const jsName = assets.find((f) => f.endsWith('.js'));
if (!jsName) throw new Error('no bundle found in dist/assets');
const js = await readFile(new URL(`assets/${jsName}`, dist), 'utf8');

const pick = (re) => (html.match(re) ?? []).join('\n');
const fontLinks = pick(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g);
const style = pick(/<style>[\s\S]*?<\/style>/g);
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const out = `${fontLinks}
<title>Getaway</title>
${style}
${body}
<script type="module">
${js}
</script>
`;

await mkdir(new URL('../artifact/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifact/getaway.html', import.meta.url), out);
console.log(`artifact/getaway.html — ${(out.length / 1024).toFixed(1)} kB`);
