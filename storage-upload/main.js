import { storage } from './firebase.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const statusEl = document.getElementById('status');
const urlEl = document.getElementById('url');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'status error' : 'status';
}

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus('Please choose a file first.', true);
    return;
  }

  uploadBtn.disabled = true;
  setStatus(`Uploading ${file.name}…`);
  urlEl.textContent = '';
  urlEl.removeAttribute('href');

  const safeName = file.name.replace(/[/\\]/g, '_');
  const path = `uploads/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);

  try {
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    setStatus('Upload complete.');
    urlEl.textContent = downloadURL;
    urlEl.href = downloadURL;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener noreferrer';
  } catch (err) {
    console.error(err);
    setStatus(
      err?.message || 'Upload failed. Check the console and Storage rules.',
      true
    );
  } finally {
    uploadBtn.disabled = false;
  }
});
