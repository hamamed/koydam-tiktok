#!/usr/bin/env node
/**
 * Builds the website (web/ -> web/out).
 * Tries Turbopack first (fast). If the native compiler package is missing,
 * e.g. npm skipped an optional download, it rebuilds with Webpack, which
 * also works with the WebAssembly fallback. Used by `npm run build`,
 * the installer, and the panel's Build/Update buttons.
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const nextBin = require.resolve('next/dist/bin/next', { paths: [root] });
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

function build(extra) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, [nextBin, 'build', 'web', ...extra], { cwd: root, env });
    const pipe = (src, dst) => src.on('data', (d) => { out += d; if (out.length > 100000) out = out.slice(-50000); dst.write(d); });
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ code, out }));
  });
}

(async () => {
  const first = await build([]);
  if (first.code === 0) process.exit(0);
  if (/Turbopack is not supported|native bindings|Failed to load SWC binary|swc.*not installed/i.test(first.out)) {
    console.log('\n⚠ Turbopack native compiler unavailable. Retrying with Webpack...\n');
    const second = await build(['--webpack']);
    process.exit(second.code ?? 1);
  }
  process.exit(first.code ?? 1);
})();
