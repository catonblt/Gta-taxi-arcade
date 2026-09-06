// Charts the economy without playing it: runs many headless shifts at fixed skill levels and
// prints what a player of each standard would actually earn, and how long the garage takes to
// fill. Tuning against this beats tuning against a hunch.
//
// Usage: node tools/balancesim.mjs [shifts]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = 5196;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const SHIFTS = Number(process.argv[2] ?? 40);

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0]));
    const path = join(ROOT, rel === '/' ? 'index.html' : rel);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 412, height: 892 } });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__getaway !== undefined);

/**
 * Skill levels, expressed as the two things a driver actually controls: how many of the offered
 * fares they land inside the fare clock, and what combo they tend to be carrying when they do.
 */
const SKILLS = [
  { name: 'struggling', completion: 0.45, combo: 1.0, bustRate: 0.35 },
  { name: 'competent', completion: 0.75, combo: 1.6, bustRate: 0.12 },
  { name: 'sharp', completion: 0.95, combo: 2.4, bustRate: 0.04 },
];

const results = await page.evaluate(
  ({ skills, shifts }) => {
    const g = window.__getaway;
    const report = {};

    for (const skill of skills) {
      // A genuinely fresh garage per skill level — resetting only the cash left the previous
      // run's maxed car in place and made every later run look instant.
      g.garage.load({
        version: 1, cash: 0, rep: 0, shifts: 0, bestShift: 0,
        current: 'beater', district: 'docks',
        owned: { beater: { levels: { engine: 0, tires: 0, suspension: 0, armor: 0 }, parts: [] } },
        inventory: [],
      });

      const earnings = [];
      let firstCarAt = null;
      let maxedAt = null;

      for (let n = 1; n <= shifts; n++) {
        const district = g.district;
        // A shift is the clock divided by how long a fare takes, times how many are landed.
        const fares = 90 / 26;
        const landed = fares * skill.completion;
        const busted = Math.random() < skill.bustRate;

        // Average tier taken: greedier the better the driver, since heat is survivable.
        const tierPay = 180 + skill.completion * 560;
        const base = landed * tierPay * skill.combo * district.payout;
        const tips = landed * 45 * skill.combo * district.payout;
        const earned = Math.round(busted ? 0 : base + tips);

        g.garage.bank(earned);
        g.garage.rep += Math.round(landed * 2 + (skill.combo - 1) * 2);
        earnings.push(earned);

        // Spend it the way a player would: a better car when one is genuinely affordable,
        // otherwise the cheapest useful step on the car they have.
        if (!firstCarAt && g.garage.cash >= 4200 && g.garage.buyVehicle('hatch')) firstCarAt = n;
        for (let guard = 0; guard < 40; guard++) {
          const axis = ['engine', 'tires', 'suspension', 'armor']
            .filter((a) => g.garage.upgradeCost(a) > 0)
            .sort((a, b) => g.garage.upgradeCost(a) - g.garage.upgradeCost(b))[0];
          if (!axis || !g.garage.canUpgrade(axis)) break;
          g.garage.upgrade(axis);
        }
        if (!maxedAt) {
          const levels = g.garage.owned[g.garage.current].levels;
          const total = levels.engine + levels.tires + levels.suspension + levels.armor;
          if (total >= 24) maxedAt = n;
        }
        // Move up the moment the door opens: the district IS the difficulty curve.
        for (const d of ['hills', 'industrial', 'downtown']) {
          const info = g.districts.find((x) => x.id === d);
          if (g.garage.rep >= info.rep) { g.garage.district = d; break; }
        }
      }

      const total = earnings.reduce((a, b) => a + b, 0);
      report[skill.name] = {
        perShift: Math.round(total / shifts),
        firstShift: earnings[0],
        bestShift: g.garage.bestShift,
        repAfter: g.garage.rep,
        district: g.garage.district,
        secondCarAtShift: firstCarAt,
        firstCarMaxedAtShift: maxedAt,
        cashLeft: Math.round(g.garage.cash),
      };
    }
    // What the whole garage costs, as the yardstick for how long the game lasts.
    const fresh = { version: 1, cash: 0, rep: 0, shifts: 0, bestShift: 0, current: 'beater', district: 'docks', owned: { beater: { levels: { engine: 0, tires: 0, suspension: 0, armor: 0 }, parts: [] } }, inventory: [] };
    g.garage.load(fresh);
    let sink = 0;
    for (const v of g.vehicles) {
      sink += v.price;
      g.garage.cash = 1e9;
      g.garage.buyVehicle(v.id);
      g.garage.select(v.id);
      for (const axis of ['engine', 'tires', 'suspension', 'armor']) {
        while (g.garage.upgradeCost(axis) > 0) {
          sink += g.garage.upgradeCost(axis);
          g.garage.upgrade(axis);
        }
      }
    }
    for (const part of g.parts) sink += part.price;
    report.contentCost = Math.round(sink);
    return report;
  },
  { skills: SKILLS, shifts: SHIFTS },
);

await browser.close();
server.close();

const contentCost = results.contentCost;
delete results.contentCost;

console.log(`\n${SHIFTS} shifts per skill level. Everything in the garage costs $${contentCost.toLocaleString('en-US')}.\n`);
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(11)} $${String(r.perShift).padStart(6)}/shift   first $${r.firstShift}`);
  console.log(`${' '.repeat(11)} 2nd car at shift ${r.secondCarAtShift ?? '—'}, starter maxed at ${r.firstCarMaxedAtShift ?? '—'}`);
  console.log(`${' '.repeat(11)} ends in ${r.district} with ${r.repAfter} rep`);
  console.log(`${' '.repeat(11)} would own the lot after ~${Math.ceil(contentCost / r.perShift)} shifts\n`);
}
