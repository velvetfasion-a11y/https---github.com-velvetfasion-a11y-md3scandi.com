import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

export { auth };

export async function createAccount(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function firebaseAuthErrorMessage(err) {
  if (!err) return 'Authentication failed.';
  const code = err.code || '';
  const messages = {
    'auth/email-already-in-use': 'This email is already in use.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/user-not-found': 'No account found for this email.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return messages[code] || err.message || 'Authentication failed.';
}

window.MD3Auth = {
  auth,
  createAccount,
  signIn,
  firebaseAuthErrorMessage,
};
