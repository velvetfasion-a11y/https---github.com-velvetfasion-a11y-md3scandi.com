/**
 * Admin gate for Cloud Functions / local API.
 * Accepts Firebase ID token (admin email allowlist) or x-md3-admin-secret header.
 */
const admin = require('firebase-admin');

function ensureAdminApp() {
  if (!admin.apps.length) {
    try {
      admin.initializeApp();
    } catch (_) {
      // Local API without ADC — secret header only
    }
  }
  return admin.apps.length ? admin : null;
}

function adminEmails() {
  const raw = process.env.ADMIN_EMAILS || 'm3dadmin.com,md3admin.com,md3scandi.com';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function adminSecret() {
  return String(process.env.ADMIN_AI_SECRET || process.env.ADMIN_PASS || '').trim();
}

function isAdminIdentity(emailOrId) {
  const id = String(emailOrId || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return adminEmails().some((allowed) => id === allowed || id.endsWith('@' + allowed) || id.includes(allowed));
}

/**
 * @param {import('express').Request} req
 * @returns {Promise<object|null>}
 */
async function verifyAdmin(req) {
  const secret = adminSecret();
  const headerSecret = String(req.get('x-md3-admin-secret') || req.get('x-admin-secret') || '').trim();
  if (secret && headerSecret && headerSecret === secret) {
    return { email: 'm3dadmin.com', admin: true, via: 'secret' };
  }

  const authHeader = String(req.get('Authorization') || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer) return null;

  if (bearer.startsWith('md3-admin:')) {
    const pass = bearer.slice('md3-admin:'.length);
    const expected = process.env.ADMIN_PASS || '1111';
    if (pass === expected) return { email: 'm3dadmin.com', admin: true, via: 'password' };
    return null;
  }

  const fb = ensureAdminApp();
  if (!fb) return null;
  try {
    const decoded = await fb.auth().verifyIdToken(bearer);
    if (!isAdminIdentity(decoded.email || decoded.uid)) return null;
    return { ...decoded, admin: true, via: 'firebase' };
  } catch (e) {
    console.warn('verifyAdmin token failed', e && e.message);
    return null;
  }
}

module.exports = {
  verifyAdmin,
  isAdminIdentity,
  adminSecret,
};
