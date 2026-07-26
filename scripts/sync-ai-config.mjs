#!/usr/bin/env node
/**
 * Generate public ai-config.js (no secrets) + gitignored ai-secrets.js (keys only)
 * from .env / process.env (CI).
 *
 * Usage: node scripts/sync-ai-config.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isCI, loadEnv } from './lib/load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicPath = path.join(root, 'ai-config.js');
const secretsPath = path.join(root, 'ai-secrets.js');

const env = loadEnv(root);

const geminiApiKey = String(env.GEMINI_API_KEY || '').trim();
const openaiApiKey = String(env.OPENAI_API_KEY || '').trim();

const publicConfig = {
  provider: env.AI_PROVIDER || 'gemini',
  geminiModel: env.GEMINI_MODEL || 'gemini-3-flash-preview',
  geminiImageModel: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
  geminiImageSize: env.GEMINI_IMAGE_SIZE || '1K',
  geminiImageAspect: env.GEMINI_IMAGE_ASPECT || '3:4',
  model: env.OPENAI_MODEL || 'gpt-4o-mini',
};

const secrets = {
  geminiApiKey,
  openaiApiKey,
};

function existingSecretsLookValid() {
  if (!fs.existsSync(secretsPath)) return false;
  try {
    const body = fs.readFileSync(secretsPath, 'utf8');
    const gemini = body.match(/"geminiApiKey"\s*:\s*"([^"]*)"/);
    const openai = body.match(/"openaiApiKey"\s*:\s*"([^"]*)"/);
    const g = (gemini && gemini[1]) || '';
    const o = (openai && openai[1]) || '';
    return (g.length > 8 && !g.includes('YOUR_')) || (o.length > 8 && !o.includes('YOUR_'));
  } catch (_) {
    return false;
  }
}

if (!secrets.geminiApiKey && !secrets.openaiApiKey) {
  const msg =
    'No GEMINI_API_KEY or OPENAI_API_KEY — admin AI will not work until keys are set.';
  // Always refresh the public (key-free) file
  fs.writeFileSync(
    publicPath,
    `/**
 * Public AI settings only — NO API keys.
 * Keys live in .env (local) / GitHub Actions secrets (CI) and are written to
 * gitignored ai-secrets.js by: node scripts/sync-ai-config.mjs
 */
window.MD3_AI_CONFIG = ${JSON.stringify(publicConfig, null, 2)};
`,
    'utf8'
  );
  if (existingSecretsLookValid()) {
    console.warn('Warning: ' + msg);
    console.warn('Keeping existing ai-secrets.js (do not overwrite with empty values).');
    console.log('Wrote', path.relative(root, publicPath), '(no keys)');
    process.exit(0);
  }
  console.error('Error: ' + msg);
  if (isCI()) {
    console.error('Add GEMINI_API_KEY in GitHub → Settings → Secrets → Actions.');
  } else {
    console.error('Set GEMINI_API_KEY in .env and re-run this script.');
  }
  process.exit(1);
}

if (/^ya29\./i.test(secrets.geminiApiKey)) {
  console.error(
    'GEMINI_API_KEY looks like a Google sign-in OAuth token (ya29.…), not a Gemini API key. Use https://aistudio.google.com/apikey (AQ.… or AIza…).'
  );
  process.exit(1);
}

fs.writeFileSync(
  publicPath,
  `/**
 * Public AI settings only — NO API keys.
 * Keys live in .env (local) / GitHub Actions secrets (CI) and are written to
 * gitignored ai-secrets.js by: node scripts/sync-ai-config.mjs
 */
window.MD3_AI_CONFIG = ${JSON.stringify(publicConfig, null, 2)};
`,
  'utf8'
);

fs.writeFileSync(
  secretsPath,
  `/**
 * AUTO-GENERATED — DO NOT COMMIT. Keys from .env / CI secrets only.
 * Regenerate: node scripts/sync-ai-config.mjs
 */
window.MD3_AI_SECRETS = ${JSON.stringify(secrets, null, 2)};
`,
  'utf8'
);

console.log('Wrote', path.relative(root, publicPath), '(no keys)');
console.log('Wrote', path.relative(root, secretsPath), '(gitignored)');
