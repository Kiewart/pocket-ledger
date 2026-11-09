// Post-build step: make the built static site work on hosts that do not
// support rewrite rules (GitHub Pages, plain S3/nginx static roots).
//
// Both hosts resolve unknown paths through a 404 document, so shipping a
// copy of index.html as 404.html turns deep links such as /transactions
// into a client-side route instead of a dead page.
//
// The copy is byte-identical to index.html, so it always matches the build.

import { copyFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const indexHtml = join(dist, 'index.html');
const notFoundHtml = join(dist, '404.html');

try {
  await stat(indexHtml);
} catch {
  console.log('[postbuild] dist/index.html not found - skipping SPA fallback copy');
  process.exit(0);
}

await copyFile(indexHtml, notFoundHtml);
console.log('[postbuild] wrote dist/404.html (SPA fallback for static hosts)');
