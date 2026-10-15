// Build sanity check (Req 1.2, 16.6): dist/ must exist, be ≤ 15 MB in total,
// and index.html must reference assets with relative paths only.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const LIMIT_BYTES = 15 * 1024 * 1024;

if (!existsSync(DIST)) {
  console.error('check-size: dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

function sizeOf(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? sizeOf(p) : st.size;
  }
  return total;
}

const total = sizeOf(DIST);
const mb = (total / 1024 / 1024).toFixed(2);
let ok = true;

if (total > LIMIT_BYTES) {
  console.error(`check-size: dist/ is ${mb} MB (limit 15 MB).`);
  ok = false;
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
if (absolute.length > 0) {
  console.error(`check-size: index.html has absolute asset paths: ${absolute.join(', ')}`);
  ok = false;
}

if (!ok) process.exit(1);
console.log(`check-size: OK (${mb} MB, relative asset paths).`);
