#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './lib/load-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(root);
const outPath = path.join(root, 'recaptcha-config.js');

const config = {
  siteKey: env.RECAPTCHA_SITE_KEY || '',
  projectId: env.RECAPTCHA_PROJECT_ID || env.FIREBASE_PROJECT_ID || '',
  apiKey: env.RECAPTCHA_API_KEY || '',
  assessmentUrl: env.RECAPTCHA_ASSESSMENT_URL || '',
  googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || '',
  minScore: 0.5,
};

fs.writeFileSync(
  outPath,
  `/**
 * AUTO-GENERATED from .env — DO NOT COMMIT.
 * Regenerate: node scripts/sync-recaptcha-config.mjs
 */
window.MD3_RECAPTCHA_CONFIG = ${JSON.stringify(config, null, 2)};
`,
  'utf8'
);
console.log('Wrote', path.relative(root, outPath));
