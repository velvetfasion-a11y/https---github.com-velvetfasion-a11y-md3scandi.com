#!/usr/bin/env node
/**
 * Local admin AI API (same handlers as Cloud Functions).
 * Keys stay in .env — never in the browser.
 *
 * Usage: node scripts/dev-admin-ai.mjs
 * Then open compte with ai-config adminAiBaseUrl http://127.0.0.1:8787
 */
import http from 'http';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadEnv } from './lib/load-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
loadEnv(root);

const require = createRequire(import.meta.url);
const { handleAdminAiPrompt, handleAdminAiImage } = require('../functions/admin-ai.js');

const PORT = Number(process.env.ADMIN_AI_PORT || 8787);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function wrapRes(res) {
  const out = {
    statusCode: 200,
    headers: {},
    set(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      const body = JSON.stringify(obj);
      res.writeHead(this.statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-md3-admin-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        ...this.headers,
      });
      res.end(body);
    },
    send(text) {
      res.writeHead(this.statusCode, this.headers);
      res.end(text || '');
    },
  };
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const fakeRes = wrapRes(res);

  if (req.method === 'OPTIONS') {
    fakeRes.status(204).send('');
    return;
  }

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const fakeReq = {
      method: req.method,
      body,
      get(name) {
        return req.headers[String(name).toLowerCase()];
      },
    };

    if (url.pathname === '/adminAiPrompt' || url.pathname === '/admin-ai/prompt') {
      await handleAdminAiPrompt(fakeReq, fakeRes);
      return;
    }
    if (url.pathname === '/adminAiImage' || url.pathname === '/admin-ai/image') {
      await handleAdminAiImage(fakeReq, fakeRes);
      return;
    }
    fakeRes.status(404).json({ error: 'Not found. Use POST /adminAiPrompt or /adminAiImage' });
  } catch (e) {
    console.error(e);
    fakeRes.status(500).json({ error: e.message || String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MD3 admin AI API on http://127.0.0.1:${PORT}`);
  console.log('  POST /adminAiPrompt');
  console.log('  POST /adminAiImage');
  console.log('GEMINI_API_KEY set:', Boolean(process.env.GEMINI_API_KEY));
});
