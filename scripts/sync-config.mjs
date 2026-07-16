#!/usr/bin/env node
/**
 * Generate all browser config files from .env.
 * Usage: node scripts/sync-config.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

for (const script of ['sync-firebase-config.mjs', 'sync-ai-config.mjs']) {
  const res = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (res.status !== 0) process.exit(res.status || 1);
}
