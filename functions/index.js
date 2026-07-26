const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { handleAdminAiPrompt, handleAdminAiImage } = require('./admin-ai.js');

setGlobalOptions({
  region: 'europe-west1',
  maxInstances: 10,
  timeoutSeconds: 120,
  memory: '1GiB',
});

function withCors(handler) {
  return async (req, res) => {
    res.set('Access-Control-Allow-Origin', req.get('Origin') || '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-md3-admin-secret');
    res.set('Access-Control-Max-Age', '3600');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }
    return handler(req, res);
  };
}

exports.adminAiPrompt = onRequest(
  {
    secrets: ['GEMINI_API_KEY', 'ADMIN_AI_SECRET'],
    invoker: 'public',
  },
  withCors(handleAdminAiPrompt)
);

exports.adminAiImage = onRequest(
  {
    secrets: ['GEMINI_API_KEY', 'ADMIN_AI_SECRET'],
    invoker: 'public',
  },
  withCors(handleAdminAiImage)
);
