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
| `md3-store.js` | Données partagées (localStorage) |
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
