# MD3 Admin AI — behavior reference

## Architecture

```
┌─────────────┐     classifyIntent /     ┌──────────────┐
│ User + imgs │ ──► local rewrites ─────►│ Gemini chat  │
└─────────────┘     (attachments, focus) │ (JSON plan)  │
                                         └──────┬───────┘
                                                │ { reply, actions[] }
                                                ▼
                                         ┌──────────────┐
                                         │ executeAll   │──► MD3Store / SiteAssets / Lang
                                         │ + Undo snaps │
                                         └──────────────┘
                                                │
                     optional Nano Banana ──────┘
                     (generate/replace product photos)
```

**Model roles**

- **Chat / planner:** `geminiModel` (default `gemini-3-flash-preview`) — reads text + images, returns JSON actions.
- **Image gen:** `geminiImageModel` (default `gemini-3-pro-image`) — “Nano Banana” product photos from prompt + optional reference image.

OpenAI is a secondary path if configured (`openaiApiKey`); Gemini is primary.

---

## Conversation loop (`handleSend`)

1. Read input + current attachments.
2. If no cloud key → `parseLocalCommands` (regex heuristics) or show setup message.
3. Else call Gemini with:
   - system prompt (`buildSystemPrompt`) including product catalog snapshot, focused product, site image slots
   - chat history (up to 24 turns, images re-attached as Gemini parts)
   - this turn’s text + compressed image data-URLs
4. Parse JSON (`parseAiJson`).
5. Run safety nets:
   - `rewriteMisclassifiedActions`
   - `expandMultiImageActions`
   - `normalizeActions`
   - convert mistaken `add_product` → update/append when focus / “this product”
6. `captureSnapshot()` then `executeAll(actions, files)`.
7. Show `reply` + Undo button; persist session to `localStorage` (`md3_admin_ai_session`, 30 min TTL).

---

## Intent rules (local, before/after the model)

| User intent | Behavior |
|-------------|----------|
| “different / separate products” + many photos | One `add_product` per image |
| “this product” / editor focused + many photos | One `append_product_images` (gallery) |
| “change / replace image” | Update existing — never `add_product` |
| “hero / mode / maison image” | `set_site_image` with slot |
| “headline / text” | `set_site_text` |
| AI lifestyle/catalog shots | `generate_product_images` / `replace_product_image` |

Focus chip: `setFocusedProduct(id, name)` from the product editor so `match:"focused"` resolves.

Image matching: fingerprint / Gemini identify can resolve which product an attached screenshot refers to.

---

## Action types (executor)

| type | Effect |
|------|--------|
| `seed_defaults` | Restore default product catalogue |
| `set_site_image` | Homepage slot: `hero`, `fashion`, `maison`, `lifestyle`, `limited`, `manifesto` |
| `set_hero_image` / `set_fashion_image` | Aliases |
| `set_site_text` | i18n key + value (`lang`: `fr`\|`en`\|`ar`\|`all`) |
| `add_product` | New catalogue item; may include `imageIndex` / `imageIndices` / `generateGallery` |
| `update_product` | Patch fields; optional image replace/append |
| `append_product_images` | Add uploaded images to one product gallery |
| `replace_product_image` | Nano Banana — replace main photo |
| `generate_product_images` | Nano Banana — add gallery shots |
| `delete_product` | Remove product |
| `set_featured` | Set homepage featured flags by ids |

Each action object **must** include `"type"`. Gemini is instructed to reply **only** with:

```json
{ "reply": "…", "actions": [ { "type": "…", … } ] }
```

---

## Undo / redo

- Before executing, snapshot: products + site assets (+ taxonomy if present).
- Undo restores snapshot via `saveProducts` / site asset APIs.
- Redo reapplies the next snapshot on the stack.
- Up to 10 persisted snapshots in the session payload.

---

## Adapters you must provide

### `window.MD3_AI_CONFIG`

See `ai-config.example.js`.

### `window.MD3Store` (required for product actions)

Minimum surface used by the AI:

```js
MD3Store.getProducts()
MD3Store.saveProducts(list, { onlyIds?, deletedIds?, removeImageIds? })
MD3Store.defaultProducts()          // for seed_defaults
MD3Store.normalizeProductFields(p)
MD3Store.normalizeProductImages(p)  // string[] of image urls/data-urls
```

### `window.MD3SiteAssets` (optional — site images)

```js
MD3SiteAssets.getCatalog()          // [{ slot, … }]
MD3SiteAssets.setImage(slot, dataUrlOrUrl)
MD3SiteAssets.applyToDocument()
```

### `window.MD3Lang` (optional — copy + i18n)

```js
MD3Lang.t(key)
MD3Lang.getLang()
MD3Lang.getEditableTextCatalog()    // keys AI may edit
MD3Lang.setSiteText?.(key, value, lang)
```

### DOM (from `ui-snippet.html`)

`adminAi`, `adminAiToggle`, `adminAiFocus`, `adminAiKeyWarn`, `adminAiMessages`, `adminAiAttachments`, `adminAiAttachBtn`, `adminAiFileInput`, `adminAiInput`, `adminAiSendBtn`

---

## Gemini HTTP shape

Chat:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
Header: x-goog-api-key: <key>
Body: { contents: [ { role, parts: [ {text}, {inline_data:{mime_type,data}} ] } ], … }
```

Image generation uses the image model with aspect/size config (`buildGeminiImageRequest`).

---

## Limits / constants (in code)

- Max attachments: **8**
- Max image file: **12 MB** (then compressed for upload)
- Chat history turns: **24**
- Gallery AI shots: up to **4**
- Session TTL: **30 minutes**

---

## Porting tips

1. Copy this folder into another project.
2. Implement a thin `MD3Store`-compatible product store (even in-memory).
3. Paste UI + CSS; call `MD3AdminAI.init()`.
4. Or strip `executeAll` and map `actions[]` to your own CMS/API — keep the Gemini planner + intent layer as-is.
5. For a headless API, call the same flow without DOM: build contents → Gemini → parse → your executor.
