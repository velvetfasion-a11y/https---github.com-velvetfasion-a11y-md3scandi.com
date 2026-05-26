import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDr7b9MebBu1ODxtC6umoWf1fb0B3cheuQ',
  authDomain: 'md3scadi.firebaseapp.com',
  projectId: 'md3scadi',
  storageBucket: 'md3scadi.firebasestorage.app',
  messagingSenderId: '1045238752087',
  appId: '1:1045238752087:web:133a1110d07ef319bd5412',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);
