/** Firebase modular SDK via CDN — config from firebase-config.js (load that script first). */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

function getFirebaseConfig() {
  const c = typeof window !== 'undefined' ? window.MD3_FIREBASE_CONFIG : null;
  if (!c || !c.apiKey || String(c.apiKey).includes('YOUR_')) {
    throw new Error(
      'Firebase is not configured. Set FIREBASE_* in .env and run node scripts/sync-config.mjs'
    );
  }
  return c;
}

const firebaseConfig = getFirebaseConfig();
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);

export { createUserWithEmailAndPassword, signInWithEmailAndPassword };
