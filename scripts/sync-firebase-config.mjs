#!/usr/bin/env node
/**
 * Generate firebase-config.js from .env (and process.env for CI).
 * Usage: node scripts/sync-firebase-config.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isCI, loadEnv } from './lib/load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'firebase-config.js');

const env = loadEnv(root);

const config = {
  apiKey: env.FIREBASE_API_KEY || '',
  authDomain: env.FIREBASE_AUTH_DOMAIN || '',
  projectId: env.FIREBASE_PROJECT_ID || '',
  storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.FIREBASE_APP_ID || '',
  measurementId: env.FIREBASE_MEASUREMENT_ID || '',
};

if (config.measurementId === '') delete config.measurementId;

const body = `/**
 * AUTO-GENERATED — do not edit. All values belong in .env only.
 * Run: node scripts/sync-firebase-config.mjs
 */
window.MD3_FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('Wrote', path.relative(root, outPath));

const required = [
  ['FIREBASE_API_KEY', config.apiKey],
  ['FIREBASE_AUTH_DOMAIN', config.authDomain],
  ['FIREBASE_PROJECT_ID', config.projectId],
  ['FIREBASE_STORAGE_BUCKET', config.storageBucket],
  ['FIREBASE_MESSAGING_SENDER_ID', config.messagingSenderId],
  ['FIREBASE_APP_ID', config.appId],
];
const missing = required.filter(([, v]) => !v || String(v).includes('YOUR_')).map(([k]) => k);

if (missing.length) {
  const msg = 'Missing in .env: ' + missing.join(', ');
  // Never block GitHub Pages deploy — storefront still works with local defaults.
  console.warn('Warning: ' + msg);
  if (isCI()) {
    console.warn('Add Firebase secrets in GitHub → Settings → Secrets → Actions for cloud product sync.');
  }
}
