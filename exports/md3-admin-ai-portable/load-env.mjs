import fs from 'fs';
import path from 'path';

export function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export function loadEnv(root) {
  const envPath = path.join(root, '.env');
  const merged = {};
  if (fs.existsSync(envPath)) {
    Object.assign(merged, parseEnvFile(fs.readFileSync(envPath, 'utf8')));
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (val != null && val !== '') merged[key] = val;
  }
  return merged;
}

export function isCI() {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}
