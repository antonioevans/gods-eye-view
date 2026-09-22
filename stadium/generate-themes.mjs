import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/stadium/theme/', import.meta.url));
const manifestPath = fileURLToPath(new URL('./theme/index.json', import.meta.url));
const brands = [
  ['midnight', 'Midnight', 215, true], ['command', 'Command', 190, true],
  ['navy', 'Navy', 225, true], ['forest', 'Forest', 150, true],
  ['copper', 'Copper', 28, true], ['violet', 'Violet', 272, true],
  ['crimson', 'Crimson', 350, true], ['slate', 'Slate', 210, true],
  ['ocean', 'Ocean', 198, true], ['amber', 'Amber', 42, true],
  ['paper', 'Paper', 215, false], ['porcelain', 'Porcelain', 190, false],
  ['linen', 'Linen', 45, false], ['sage', 'Sage', 145, false],
  ['sand', 'Sand', 32, false], ['ice', 'Ice', 205, false],
  ['rose', 'Rose', 342, false], ['lavender', 'Lavender', 275, false],
  ['mint', 'Mint', 158, false], ['stone', 'Stone', 220, false],
];
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
const luminance = ([r, g, b]) => [r, g, b].map((v) => {
  v /= 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
}).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
function rgb(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const lightInk = [255, 255, 255], darkInk = [10, 19, 30];
const readableInk = (fill) => contrast(fill, lightInk) >= contrast(fill, darkInk) ? '#fff' : '#0a131e';
const manifest = [];
mkdirSync(root, { recursive: true });
for (const [brand, name, hue, dark] of brands) {
  const bg = [hue, dark ? 28 : 26, dark ? 7 : 97];
  const surface = [hue, dark ? 25 : 24, dark ? 11 : 94];
  const surfaceAlt = [hue, dark ? 24 : 21, dark ? 15 : 90];
  const text = [hue, dark ? 24 : 36, dark ? 95 : 9];
  const muted = [hue, dark ? 13 : 14, dark ? 67 : 37];
  const border = [hue, dark ? 18 : 17, dark ? 28 : 76];
  const primary = [hue, 80, dark ? 64 : 35];
  const accent = [(hue + 40) % 360, 75, dark ? 63 : 34];
  const success = [152, 72, dark ? 58 : 29];
  const danger = [5, 82, dark ? 65 : 40];
  const warning = [39, 89, dark ? 65 : 36];
  const background = rgb(...bg);
  if (contrast(rgb(...text), background) < 7 || contrast(rgb(...muted), background) < 3 || contrast(rgb(...success), background) < 3.5 || contrast(rgb(...danger), background) < 3.5 || contrast(rgb(...warning), background) < 3.5) throw new Error(`Contrast failed: ${brand}`);
  const vars = {
    'color-scheme': dark ? 'dark' : 'light',
    '--theme-bg': hsl(...bg), '--theme-surface': hsl(...surface), '--theme-surface-alt': hsl(...surfaceAlt),
    '--theme-text': hsl(...text), '--theme-text-muted': hsl(...muted), '--theme-border': hsl(...border),
    '--theme-primary': hsl(...primary), '--theme-on-primary': readableInk(rgb(...primary)),
    '--theme-accent': hsl(...accent), '--theme-on-accent': readableInk(rgb(...accent)),
    '--theme-success': hsl(...success), '--theme-on-success': readableInk(rgb(...success)),
    '--theme-danger': hsl(...danger), '--theme-on-danger': readableInk(rgb(...danger)),
    '--theme-warning': hsl(...warning),
    '--theme-font-body': "'DM Sans', sans-serif", '--theme-font-display': "'Barlow Condensed', sans-serif",
    '--theme-font-mono': "'IBM Plex Mono', monospace",
    '--theme-radius-sm': '6px', '--theme-radius': '10px', '--theme-radius-lg': '16px', '--theme-radius-pill': '999px',
  };
  writeFileSync(`${root}${brand}.css`, `[data-theme="${brand}"]{${Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';')}}\n`);
  manifest.push({ brand, name, isDark: dark, swatches: [bg, surface, primary, accent, text].map((x) => hsl(...x)), file: `/stadium/theme/${brand}.css` });
}
mkdirSync(fileURLToPath(new URL('./theme/', import.meta.url)), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${manifest.length} contrast-checked themes`);
