# MD3 Admin AI — portable package

This folder is a copy of the site’s admin AI so you can reuse it elsewhere.

## What’s included

| File | Role |
|------|------|
| `md3-admin-ai.js` | Full assistant (~3k lines) — chat UI logic, Gemini calls, intent, actions, undo |
| `ai-config.example.js` | Browser config (`window.MD3_AI_CONFIG`) |
| `sync-ai-config.mjs` | Builds `ai-config.js` from `.env` |
| `test-gemini.mjs` | Verifies your Gemini API key |
| `load-env.mjs` | Env loader used by sync/test scripts |
| `ui-snippet.html` | Chat panel markup (`#adminAi` …) |
| `admin-ai.css` | Styles for the panel |
| `BEHAVIOR.md` | How it thinks and what actions it runs |

## How it behaves (short)

1. User types + optionally attaches images (max 8).
2. Local intent classifiers rewrite ambiguous requests (e.g. “change this image” → update, not add).
3. Gemini chat model returns **JSON only**: `{ reply, actions:[{type,…}] }`.
4. `executeAll` runs each action against your store / site APIs.
5. Every turn can be **Undo** / **Redo** (snapshot of products + site assets).
6. Chat memory lives in `localStorage` for 30 minutes.

## Wire it up

```html
<link rel="stylesheet" href="admin-ai.css" />
<!-- … paste ui-snippet.html … -->

<script src="ai-config.js"></script>
<script src="md3-admin-ai.js"></script>
<script>
  // Required globals — see BEHAVIOR.md “Adapters”
  MD3AdminAI.init();
</script>
```

## Config

```bash
# .env
AI_PROVIDER=gemini
GEMINI_API_KEY=AQ....
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_IMAGE_MODEL=gemini-3-pro-image

node sync-ai-config.mjs
node test-gemini.mjs
```

**Important:** Use an AI Studio API key (`AQ…` / `AIza…`), not a Google OAuth `ya29…` token. Requests use header `x-goog-api-key`.

## Public API

```js
MD3AdminAI.init()
MD3AdminAI.handleSend()
MD3AdminAI.setFocusedProduct(id, name)
MD3AdminAI.getFocusedProductId()
MD3AdminAI.setAdminListContext({ visibleIds: [...] })
MD3AdminAI.executeAll(actions, files)
MD3AdminAI.parseLocalCommands(text, files) // offline / no-key fallbacks
```

## Dependencies this file expects

The script is written for MD3 Scandi. To reuse it, provide these globals (or edit the file):

- `window.MD3_AI_CONFIG` — API keys / models  
- `window.MD3Store` — products CRUD (`getProducts`, `saveProducts`, `defaultProducts`, …)  
- `window.MD3Lang` — `t(key)` for UI strings (optional)  
- `window.MD3SiteAssets` — homepage image slots (optional)  
- DOM ids from `ui-snippet.html` (`adminAi`, `adminAiInput`, …)

See **BEHAVIOR.md** for the full action list and adapter shapes.
