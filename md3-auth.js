/**
 * Firebase Auth (compat SDK) — uses MD3_FIREBASE_CONFIG from firebase-config.js
 * Load order: firebase-config.js → Firebase compat scripts → md3-firebase.js → md3-store.js → this file
 */
(function (global) {
  async function ensureAuthReady() {
    if (!global.MD3_FIREBASE_CONFIG || !global.MD3_FIREBASE_CONFIG.apiKey) {
      throw new Error('firebase-config.js is missing or empty.');
    }
    if (String(global.MD3_FIREBASE_CONFIG.apiKey).includes('YOUR_')) {
      throw new Error('Replace YOUR_API_KEY in firebase-config.js with your Firebase Web app config.');
    }
    if (!global.MD3Firebase) {
      throw new Error('md3-firebase.js did not load.');
    }
    if (global.MD3Store && global.MD3Store.ready) {
      await global.MD3Store.ready;
    }
    if (!global.MD3Firebase.isEnabled()) {
      await global.MD3Firebase.init();
    }
    const auth = global.MD3Firebase.getAuth();
    if (!auth) {
      throw new Error('Firebase Auth did not initialize. Check the browser console.');
    }
    return auth;
  }

  async function createAccount(email, password) {
    const auth = await ensureAuthReady();
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signIn(email, password) {
    const auth = await ensureAuthReady();
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signInWithGoogle() {
    const auth = await ensureAuthReady();
    if (typeof global.firebase === 'undefined') {
      throw new Error('Firebase SDK not loaded.');
    }
    const provider = new global.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const cred = await auth.signInWithPopup(provider);
      return cred.user;
    } catch (err) {
      if (
        err &&
        (err.code === 'auth/popup-blocked' ||
          err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request')
      ) {
        throw err;
      }
      await auth.signInWithRedirect(provider);
      return null;
    }
  }

  async function handleGoogleRedirectResult() {
    const auth = await ensureAuthReady();
    const cred = await auth.getRedirectResult();
    if (!cred || !cred.user) return null;
    return cred.user;
  }

  async function ensureUserProfileFromFirebase(firebaseUser) {
    const email = (firebaseUser.email || '').trim().toLowerCase();
    if (!email) throw new Error('Google account has no email.');
    const name =
      (firebaseUser.displayName || '').trim() ||
      email.split('@')[0];
    const store = global.MD3Store;
    if (!store) return { email, name };
    const users = store.getUsers();
    if (!users[email]) {
      users[email] = { name, liked: [], verified: true };
      await store.saveUsers(users);
    } else if (!users[email].name && name) {
      users[email].name = name;
      await store.saveUsers(users);
    }
    return {
      email,
      name: users[email].name || name,
    };
  }

  function firebaseAuthErrorMessage(err) {
    if (!err) return 'Authentication failed.';
    const code = err.code ? ` (${err.code})` : '';
    const msg = err.message || String(err);
    const friendly = {
      'auth/email-already-in-use': 'This email is already in use.',
      'auth/invalid-email': 'Invalid email address.',
      'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/user-not-found': 'No account found for this email.',
      'auth/invalid-credential': 'Invalid email or password.',
      'auth/too-many-requests': 'Too many attempts. Try again later.',
      'auth/network-request-failed': 'Network error. Check your connection.',
      'auth/popup-blocked': 'Pop-up blocked. Allow pop-ups for this site or try again.',
      'auth/popup-closed-by-user': 'Sign-in cancelled.',
      'auth/operation-not-allowed': 'Google sign-in is not enabled in Firebase. Enable it under Authentication → Sign-in method → Google.',
      'auth/cancelled-popup-request': 'Sign-in cancelled.',
      'auth/account-exists-with-different-credential':
        'An account already exists with this email. Sign in with email and password instead.',
      'auth/api-key-not-valid':
        'Invalid API key. Copy the config again from Firebase Console → Project settings → Your apps (Web), paste into firebase-config.js, deploy, and hard-refresh. Also check API key restrictions in Google Cloud Console.',
    };
    if (err.code && friendly[err.code]) return friendly[err.code];
    return msg + code;
  }

  let sessionSyncStarted = false;

  function sessionFromFirebaseUser(firebaseUser) {
    const email = (firebaseUser.email || '').trim().toLowerCase();
    if (!email) return null;
    const users = global.MD3Store ? global.MD3Store.getUsers() : {};
    const profile = users[email] || { name: email.split('@')[0], liked: [] };
    return { email, name: profile.name || email.split('@')[0], isAdmin: false };
  }

  async function initSessionSync() {
    if (sessionSyncStarted) return;
    sessionSyncStarted = true;
    let auth;
    try {
      auth = await ensureAuthReady();
    } catch (_) {
      return;
    }
    auth.onAuthStateChanged(function (firebaseUser) {
      const store = global.MD3Store;
      if (!store) return;
      const cur = store.getCurrentUser();
      if (!firebaseUser) {
        if (cur && !cur.isAdmin) {
          store.clearSession();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('md3-session-changed'));
          }
        }
        return;
      }
      if (cur && cur.isAdmin) return;
      const session = sessionFromFirebaseUser(firebaseUser);
      if (!session) return;
      store.setCurrentUser(session);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('md3-session-changed'));
      }
    });
  }

  async function signOut() {
    const auth = await ensureAuthReady();
    await auth.signOut();
    if (global.MD3Store) global.MD3Store.clearSession();
  }

  global.MD3Auth = {
    createAccount,
    signIn,
    signInWithGoogle,
    handleGoogleRedirectResult,
    ensureUserProfileFromFirebase,
    signOut,
    initSessionSync,
    firebaseAuthErrorMessage,
    ensureAuthReady,
  };
})(typeof window !== 'undefined' ? window : globalThis);
