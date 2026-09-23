import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base', '/gods-eye-view/'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);

// vite-plugin-cesium copies its runtime under the base path inside dist.
// Pages already serves dist at that path, so move the runtime to the site root.
const nested = fileURLToPath(new URL('../dist/gods-eye-view/cesium/', import.meta.url));
const rootRuntime = fileURLToPath(new URL('../dist/cesium/', import.meta.url));
if (!existsSync(nested)) throw new Error('Cesium runtime missing from the Pages build');
renameSync(nested, rootRuntime);
rmSync(fileURLToPath(new URL('../dist/gods-eye-view/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../dist/.nojekyll', import.meta.url)), '');
