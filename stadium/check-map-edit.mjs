import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4173/stadium.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.click('#simple-3d');
await new Promise((resolve) => setTimeout(resolve, 2500));
await page.click('#simple-play');

async function findHover(needle, positions) {
  for (const [x, y] of positions) {
    await page.mouse.move(x, y);
    const text = await page.$eval('#map-tooltip', (element) => element.hidden ? '' : element.textContent);
    if (text.includes(needle) && (needle !== 'Mapped path' || !text.includes('junction'))) return { x, y, text };
  }
  throw new Error(`Could not hover ${needle}`);
}

const group = await findHover('Synthetic visitors', [[622, 305], [622, 312], [850, 282]]);
const groupHover = group.text;
await page.mouse.down();
await page.mouse.move(700, 140, { steps: 12 });
await page.mouse.up();
const groupStartNodes = await page.evaluate(() => JSON.parse(localStorage.getItem('noble-citi-field-flow-v1')).rules.groupStartNodes);
assert.equal(Object.keys(groupStartNodes).length, 1);
mkdirSync('output', { recursive: true });

const gate = await findHover('Simulated entry', [[389, 526], [385, 526], [393, 526], [389, 522], [389, 530], [381, 530], [397, 522]]);
const gateHover = gate.text;
await page.mouse.down();
await page.mouse.move(412, 505, { steps: 8 });
await page.mouse.up();
const gateNode = await page.evaluate(() => JSON.parse(localStorage.getItem('noble-citi-field-flow-v1')).rules.gateNodes.east);
assert.ok(gateNode);

const path = await findHover('Mapped path', [[1080, 230], [1090, 230], [700, 140]]);
const pathHover = path.text;
await page.mouse.click(path.x, path.y);
assert.ok((await page.$eval('#map-inspector', (element) => element.textContent)).includes('Block path'));
await page.click('#map-item-actions button');
const barriers = await page.evaluate(() => JSON.parse(localStorage.getItem('noble-citi-field-flow-v1')).barriers);
assert.equal(barriers.length, 1);
assert.equal(barriers[0].kind, 'closed');

mkdirSync('output', { recursive: true });
await page.screenshot({ path: 'output/stadium-map-edit.png' });
assert.deepEqual(errors, []);
await browser.close();
console.log(JSON.stringify({ groupHover, groupStartNodes, gateHover, gateNode, pathHover, barriers: barriers.length, errors }, null, 2));
