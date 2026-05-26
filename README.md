# MD3 Scandi — Mode & Maison

Boutique vitrine MD3 Scandi (mode, maison, lifestyle) — page unique HTML/CSS/JS.

**Site en ligne :** [https://md3scandi.com](https://md3scandi.com)

## Aperçu

- Hero, collections Mode / Maison / Lifestyle / Édition limitée
- Sous-catégories dépliables (Mode & Maison)
- Manifeste, trois principes, footer réseaux sociaux
- Design scandinave clair (crème, or, Jost + Cormorant Garamond)
- Boutique avec sauvegarde d’articles (compte client)
- Admin inventaire : `login.html` — `m3dadmin.com` / `1111`

## Lancer en local

Ouvrir `index.html` dans le navigateur, ou :

```bash
cd /Users/juliarense/Documents/MD3scandi
python3 -m http.server 8080
```

Puis : [http://localhost:8080](http://localhost:8080)

## Fichiers

| Fichier     | Rôle              |
|------------|-------------------|
| `index.html` | Vitrine + boutique |
| `compte.html` | Compte, profil, admin |
| `md3-store.js` | Boutique (cache local + sync Firebase) |
| `md3-firebase.js` | Sync cloud Firestore + Storage |
| `firebase-config.js` | Clés Firebase (à remplir) |
| `md3-email.js` | Envoi du code de confirmation (EmailJS) |
| `email-config.js` | Clés EmailJS (à remplir) |

## Confirmation email à l’inscription

Chaque nouvelle inscription envoie un **code à 6 chiffres** par email avant d’activer le compte.

1. Créez un compte gratuit sur [emailjs.com](https://www.emailjs.com/)
2. Ajoutez un **Email Service** (Gmail, Outlook, etc.)
3. Créez un **template** avec :
   - **To:** `{{to_email}}`
   - Corps du message : votre code est `{{code}}` (ou `{{passcode}}`)
4. Copiez `email-config.example.js` vers `email-config.js` et renseignez `serviceId`, `templateId`, `publicKey`
5. Déployez `email-config.js` avec le site (ne commitez pas de clés privées si le repo est public — la public key EmailJS est faite pour le client)

Sans configuration, l’inscription affichera une erreur ; une fois configuré, l’email part en quelques secondes via l’API EmailJS.

## Firebase (données sur tous les appareils)

Produits, images, comptes clients et paniers sont synchronisés via **Cloud Firestore** et **Firebase Storage** (même catalogue sur téléphone, ordinateur et admin).

### 1. Créer le projet

1. [console.firebase.google.com](https://console.firebase.google.com/) → **Ajouter un projet**
2. **Build** → **Firestore Database** → créer en mode test (ou production avec règles ci‑dessous)
3. **Build** → **Storage** → démarrer (bucket par défaut)

### 2. Configurer le site

1. **Paramètres du projet** → vos applications → **Web** `</>` → copier la config
2. `cp firebase-config.example.js firebase-config.js` et coller `apiKey`, `projectId`, `storageBucket`, etc.
3. Déployer **`firebase-config.js`** avec le site (comme `email-config.js`)

Sans `firebase-config.js` valide, le site fonctionne encore en **localStorage** (données seulement sur ce navigateur).

### 3. Règles de sécurité (obligatoire — sinon `storage/unauthorized`)

Si l’admin affiche **« User does not have permission to access 'products/…' »**, les règles Storage ne sont pas publiées. Corrigez ainsi :

1. [Firebase Console](https://console.firebase.google.com/) → projet **md3scadi**
2. **Build** → **Storage** → onglet **Rules**
3. Remplacez tout le contenu par le fichier **`storage.rules`** de ce repo (ou le bloc ci‑dessous)
4. Cliquez **Publish** / **Publier**
5. Attendez ~30 secondes, puis réessayez l’upload dans l’admin

**Firestore** → Règles (même principe, fichier **`firestore.rules`**) :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Storage** → Règles :

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /products/{fileName} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

> Pour la production, restreignez les écritures (ex. Firebase Auth + custom claims admin). Les mots de passe comptes sont encore gérés côté client — prévoir Auth plus tard pour une vraie sécurité.

### 4. Première visite

Au premier chargement avec Firebase actif, les produits locaux sont envoyés dans le cloud. Les photos admin sont stockées dans **Storage** (URL publique), pas en base64 dans Firestore.
