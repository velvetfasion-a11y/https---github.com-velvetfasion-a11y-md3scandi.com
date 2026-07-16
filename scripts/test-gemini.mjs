#!/usr/bin/env node
/**
 * Verify GEMINI_API_KEY works with Google AI (Generative Language API).
 * Usage: node scripts/test-gemini.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = fs.existsSync(envPath) ? parseEnvFile(fs.readFileSync(envPath, 'utf8')) : {};
const key = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '';

if (!key) {
  console.error('FAIL: GEMINI_API_KEY is not set in .env');
  process.exit(1);
}

if (/^ya29\./i.test(key)) {
  console.error('FAIL: GEMINI_API_KEY looks like a Google sign-in OAuth token (ya29.…), not a Gemini API key.');
  console.error('Create an API key at https://aistudio.google.com/apikey (AQ.… or AIza…)');
  process.exit(1);
}

if (!/^AQ\.[\w-]{20,}/i.test(key) && !/^AIza[\w-]{20,}/i.test(key)) {
  console.warn('WARN: Key does not match the usual AQ.… or AIza… format. Testing anyway…');
}

const model = process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-3-flash-preview';
const url =
  'https://generativelanguage.googleapis.com/v1beta/models/' +
  encodeURIComponent(model) +
  ':generateContent';

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': key,
  },
  body: JSON.stringify({
    contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
  }),
});

const body = await res.text();
if (!res.ok) {
  console.error('FAIL: HTTP', res.status);
  console.error(body.slice(0, 600));
  if (res.status === 401) {
    console.error('\nRegenerate your key at https://aistudio.google.com/apikey');
    if (/ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(body)) {
      console.error('(AQ. keys must use the x-goog-api-key header — this script already does.)');
    }
  }
  if (res.status === 403) {
    console.error('\nEnable "Generative Language API" for your Google Cloud project, or create a new AI Studio key.');
  }
  process.exit(1);
}

console.log('OK: Gemini chat API works with model', model);
const data = JSON.parse(body);
const text =
  data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
if (text) console.log('Response:', text.trim().slice(0, 80));
