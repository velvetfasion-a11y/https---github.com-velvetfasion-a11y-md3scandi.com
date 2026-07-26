/**
 * MD3 Admin — AI assistant with chat memory, Gemini Pro, and product image generation
 */
(function (global) {
  const S = () => global.MD3Store;
  const L = (k) => (global.MD3Lang ? global.MD3Lang.t(k) : k);
  const MAX_ATTACH = 8;
  /** Longest edge for images shown in chat + sent to the planner model. */
  const AI_ATTACH_MAX_EDGE = 1280;
  /** Longest edge for reference images sent to the image model. */
  const AI_REF_MAX_EDGE = 1280;
  /** Longest edge when saving AI-generated product photos (before Storage upload). */
  const AI_STORE_MAX_EDGE = 1800;
  /** JPEG quality for stored AI product photos (0–1). */
  const AI_STORE_JPEG_QUALITY = 0.94;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_HISTORY_TURNS = 24;
  const MAX_GALLERY_SHOTS = 2;
  const HISTORY_KEY = 'md3_admin_ai_session';
  const HISTORY_TTL_MS = 30 * 60 * 1000;
  const MAX_PERSISTED_SNAPSHOTS = 10;

  let attachments = [];
  let busy = false;
  let chatHistory = [];
  let sessionCtx = {
    lastProductNames: [],
    lastFiles: [],
    focusedProductId: null,
    focusedProductName: '',
    adminVisibleIds: [],
    resolvedProductId: null,
    resolvedImageIndex: null,
    resolvedMatchMethod: '',
  };
  let turnSnapshots = [];
  let redoStack = [];
  let historySaveTimer = null;
  let activeAbort = null;
  let cancelRequested = false;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function sanitizeRestoredHtml(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = String(html || '');
    wrap.querySelectorAll('script,iframe,object,embed,link,meta').forEach((n) => n.remove());
    wrap.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const n = attr.name.toLowerCase();
        const v = String(attr.value || '');
        if (n.startsWith('on') || /javascript:/i.test(v)) el.removeAttribute(attr.name);
      });
    });
    return wrap.innerHTML;
  }

  function currentLangCode() {
    return global.MD3Lang && global.MD3Lang.getLang ? global.MD3Lang.getLang() : 'fr';
  }

  function getCfg() {
    const pub = global.MD3_AI_CONFIG || {};
    const sec = global.MD3_AI_SECRETS || {};
    return Object.assign({}, pub, sec);
  }

  var LIVE_ADMIN_AI_BASE = 'https://europe-west1-md3scadi.cloudfunctions.net';

  function adminAiBaseUrl() {
    // Localhost only → local API. Live domain always uses Cloud Functions.
    try {
      const host = String(location.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://127.0.0.1:8787';
      }
      if (/(^|\.)md3scandi\.com$/i.test(host) || /(^|\.)md3scadi\.web\.app$/i.test(host)) {
        const cfgLive = getCfg().adminAiBaseUrl || '';
        return String(cfgLive || LIVE_ADMIN_AI_BASE).replace(/\/$/, '');
      }
    } catch (_) {}
    const cfg = getCfg().adminAiBaseUrl || LIVE_ADMIN_AI_BASE;
    return cfg ? String(cfg).replace(/\/$/, '') : '';
  }

  function adminAiAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const secret = getCfg().adminAiSecret || (global.MD3_AI_SECRETS && global.MD3_AI_SECRETS.adminAiSecret);
    if (secret) headers['x-md3-admin-secret'] = String(secret);
    // MD3 admin session uses a local password gate — same gate the Functions verify
    try {
      const store = S();
      const user = store && store.getCurrentUser && store.getCurrentUser();
      const pass = (store && store.ADMIN_PASS) || '1111';
      if (user && user.isAdmin) {
        headers.Authorization = 'Bearer md3-admin:' + pass;
      }
    } catch (_) {}
    return headers;
  }

  function geminiKey() {
    // Keys must not live in the browser — always empty here
    return '';
  }

  function hasAdminAiBackend() {
    return !!adminAiBaseUrl();
  }

  function geminiModelUrl(model, method) {
    return (
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':' +
      (method || 'generateContent')
    );
  }

  function geminiFetchOptions(key, body, signal) {
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    };
    if (signal) opts.signal = signal;
    return opts;
  }

  function beginAbortableWork() {
    cancelRequested = false;
    if (activeAbort) {
      try {
        activeAbort.abort();
      } catch (_) {}
    }
    activeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setCancelUi(true);
    return activeAbort ? activeAbort.signal : null;
  }

  function endAbortableWork() {
    activeAbort = null;
    cancelRequested = false;
    setCancelUi(false);
  }

  function requestCancelAi() {
    cancelRequested = true;
    if (activeAbort) {
      try {
        activeAbort.abort();
      } catch (_) {}
    }
  }

  function throwIfCancelled() {
    if (cancelRequested) throw new Error(msg('admin-ai-cancelled', 'Cancelled.'));
  }

  function setCancelUi(on) {
    const btn = $('adminAiCancelBtn');
    if (!btn) return;
    btn.hidden = !on;
    btn.disabled = !on;
  }

  function geminiKeyIssue() {
    const k = geminiKey();
    if (!k) return 'missing';
    if (/^ya29\./i.test(k)) {
      return 'oauth_not_api_key';
    }
    if (/^AQ\.[\w-]{20,}/i.test(k) || /^AIza[\w-]{20,}/i.test(k)) {
      return '';
    }
    return 'bad_format';
  }

  function hasGemini() {
    return hasAdminAiBackend();
  }

  function openaiKey() {
    return '';
  }

  function hasOpenAI() {
    return false;
  }

  function hasCloudAI() {
    return hasAdminAiBackend();
  }

  function cloudAISetupMessage() {
    return msg(
      'admin-ai-err-no-backend',
      'Admin AI backend offline. Locally: set GEMINI_API_KEY in .env, run node scripts/dev-admin-ai.mjs, and set ADMIN_AI_BASE_URL=http://127.0.0.1:8787. Production: deploy Cloud Functions with GEMINI_API_KEY secret.'
    );
  }

  function geminiAuthFailureMessage() {
    return msg(
      'admin-ai-err-gemini-auth',
      'Gemini rejected this API key (invalid or expired). Use a working key from aistudio.google.com/apikey in .env, run node scripts/sync-ai-config.mjs, then hard-refresh this page (Cmd+Shift+R).'
    );
  }

  function formatCloudError(err) {
    const raw = String((err && err.message) || err || '');
    if (/401|UNAUTHENTICATED|ACCESS_TOKEN_TYPE_UNSUPPORTED|invalid authentication/i.test(raw)) {
      return hasGemini() ? geminiAuthFailureMessage() : cloudAISetupMessage();
    }
    if (/403|PERMISSION_DENIED|blocked|not enabled/i.test(raw)) {
      return msg(
        'admin-ai-err-gemini-disabled',
        'Gemini API rejected this key. Create a new key at aistudio.google.com/apikey and enable the Generative Language API for your project.'
      );
    }
    if (/404|NOT_FOUND|Admin AI HTTP 404/i.test(raw)) {
      return msg(
        'admin-ai-err-backend-missing',
        'Admin AI Cloud Function is not deployed yet. Locally use http://127.0.0.1:8080 and run: node scripts/dev-admin-ai.mjs. Production: firebase deploy --only functions.'
      );
    }
    if (/Failed to fetch|Load failed|NetworkError|CORS|network/i.test(raw)) {
      try {
        if (/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
          return msg(
            'admin-ai-err-local-offline',
            'Local Admin AI server is offline. In a terminal run: node scripts/dev-admin-ai.mjs — then retry.'
          );
        }
      } catch (_) {}
      return msg(
        'admin-ai-err-backend-unreachable',
        'Could not reach Admin AI backend. If on the live site, Cloud Functions must be deployed. If on localhost, start: node scripts/dev-admin-ai.mjs'
      );
    }
    if (/Invalid value at.*aspect_ratio|Invalid value at.*image_size|response_format\.image/i.test(raw)) {
      return msg(
        'admin-ai-err-image-config',
        'Image generation settings were rejected by Gemini. Retrying with updated API format — hard-refresh the admin page (Cmd+Shift+R) and try again.'
      );
    }
    return msg('admin-ai-err-cloud', 'Cloud AI error: ') + raw.slice(0, 220);
  }

  function productNotFoundMessage() {
    return msg(
      'admin-ai-err-which-product',
      'Could not find which product to update. Click a product card or Edit first, or name the product in your message.'
    );
  }

  function getVisibleProducts() {
    const ids = sessionCtx.adminVisibleIds || [];
    if (!ids.length) return [];
    const products = S().getProducts();
    return ids.map((id) => products.find((p) => p.id === id)).filter(Boolean);
  }

  function findProductFromKeywords(text) {
    const t = String(text || '').toLowerCase();
    const products = S().getProducts().filter((p) => !/^New product(\s+\d+)?$/i.test(String(p.name || '').trim()));
    if (!products.length) return null;

    const tokens = t.split(/\W+/).filter((w) => w.length > 3);
    let best = null;
    let bestScore = 0;

    for (const p of products) {
      const hay = (p.name + ' ' + (p.desc || '') + ' ' + p.category + ' ' + (p.sub || '')).toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score++;
      }
      if (
        /cloth|garment|robe|dress|outfit|wear|linen|textile|mode|fashion|vetement|vêtement|model/.test(t) &&
        /mode|fashion|vêtement|vetement|textile|cloth/i.test(hay)
      ) {
        score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore >= 2 ? best : null;
  }

  function chatModels() {
    const preferred = getCfg().geminiModel || 'gemini-3-flash-preview';
    const fallbacks = [
      'gemini-3.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ];
    return [preferred].concat(fallbacks.filter((m) => m !== preferred));
  }

  function imageModels() {
    // Prefer flash image models for speed; only one fallback.
    const preferred = getCfg().geminiImageModel || 'gemini-2.5-flash-image';
    const fallbacks = [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image',
    ];
    const list = [preferred].concat(fallbacks.filter((m) => m !== preferred));
    return list.slice(0, 2);
  }

  function dataUrlToGeminiPart(dataUrl) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    // REST accepts both casings; camelCase is what current image models return/expect
    return { inlineData: { mimeType: m[1], data: m[2] } };
  }

  function geminiPartToDataUrl(part) {
    const inline = part.inline_data || part.inlineData;
    if (!inline) return null;
    const mime = inline.mime_type || inline.mimeType || 'image/png';
    const data = inline.data;
    if (!data) return null;
    return 'data:' + mime + ';base64,' + data;
  }

  async function ensureDataUrl(url) {
    if (!url) return null;
    const s = String(url).trim();
    if (!s) return null;
    if (s.startsWith('data:')) return s;
    if (typeof urlToComparableDataUrl === 'function') {
      const via = await urlToComparableDataUrl(s);
      if (via) return via;
    }
    return null;
  }

  function buildSystemPrompt() {
    const products = S()
      .getProducts()
      .slice(0, 30)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        sub: p.sub,
        price: p.price,
        featured: p.featured,
        imageCount: (p.images && p.images.length) || (p.image ? 1 : 0),
      }));
    const recent = sessionCtx.lastProductNames.slice(-6);
    const active = getActiveProduct();
    const focused = active
      ? {
          id: active.id,
          name: active.name,
          category: active.category,
          sub: active.sub,
          price: active.price,
        }
      : null;
    const siteImages =
      global.MD3SiteAssets && global.MD3SiteAssets.getCatalog
        ? global.MD3SiteAssets.getCatalog()
        : [{ slot: 'hero' }, { slot: 'fashion' }];
    const textKeys =
      global.MD3Lang && global.MD3Lang.getEditableTextCatalog
        ? global.MD3Lang.getEditableTextCatalog().slice(0, 24)
        : [];
    return `You are MD3 Scandi admin assistant — full control over the MD3 Scandi website (homepage, shop, products).
You remember the full conversation. Use prior messages to resolve "this product", "change this", "it", "them", follow-ups, and multi-step requests.
REPLY FIELD: always set "reply" to "" (empty). The UI shows short status lines only — never narrate, never list prompts, never write French/English paragraphs.

You can change ANYTHING on the site:
- Site images (attach photo + say which section): hero, fashion/mode card, maison card, lifestyle card, limited edition card, manifesto background
- Site text/copy via set_site_text (headlines, descriptions, manifesto, values, footer, etc.)
- Products: add, update, delete, images, gallery, prices, featured
- Restore default product catalogue (seed_defaults)

CRITICAL — safety rules (never violate):
- DEFAULT for attached product photos = add_product (NEW catalogue items). Do NOT update or replace existing products.
- ONLY use update_product / replace_product_image / delete_product when the user CLEARLY says so ("change this product", "update the image", "replace photo", "delete product", "for this product").
- NEVER rewrite an add into an update because a photo looks similar to something already in the shop.
- NEVER delete or overwrite products that were not named / clearly targeted.
- "this product" / "change this" / "update it" → update that existing product only.
- "change hero / header / mode section / maison image" → set_site_image (not a product action).
- "change headline / title / text on homepage" → set_site_text.

MULTIPLE ATTACHMENTS — choose ONE mode per message:

A) DIFFERENT PRODUCTS (one listing per photo):
   User attaches 2+ photos of DIFFERENT items → return ONE add_product per image (imageIndex 0,1,2…).
   Triggers: "different/separate products", "each photo is a product", "add these to shop", multiple items without "one product".
   Analyze EACH photo separately for name, category, price, description.

B) ONE PRODUCT, MANY IMAGES (gallery / same item):
   User attaches 2+ photos of the SAME item OR says "this product", "same product", "add all images to…" OR chat already targets one product
   → ONE action only: append_product_images { match:"focused", imageIndices:[0,1,2,…] }
   OR generate_product_images / update_product_image / replace_product_image — NEVER multiple add_product.

C) If a product is OPEN in the editor and user attaches several photos WITHOUT saying "different/separate products" → mode B (one product).

D) If user says "different products" or "each is a separate product" → mode A.

Example A — 3 photos of 3 items + "add these to the shop":
  [{"type":"add_product","imageIndex":0,"name":"...","desc":"..."},{"type":"add_product","imageIndex":1,...},{"type":"add_product","imageIndex":2,...}]

Example B — 4 photos of same dress + "add all images to this product":
  [{"type":"append_product_images","match":"focused","imageIndices":[0,1,2,3]}]

MULTIPLE ATTACHMENTS (legacy detail):
- User attaches several photos of DIFFERENT items and wants new catalogue entries → return ONE add_product per image, each with a unique imageIndex (0, 1, 2…). Analyze each photo separately for name, category, price, description.
- User attaches several photos of the SAME item, or says "add these images to this product" / gallery / all photos to one product → return ONE append_product_images { match:"focused"|product name, imageIndices:[0,1,2,…] } OR update_product with appendImages:true. Never split into multiple products.
- If chat already targets one product, multiple uploads default to that ONE product unless user clearly asks for multiple new products.
- You may return several actions in one response (e.g. 3× add_product, or 1× append_product_images).

Reply ONLY with valid JSON:
{"reply":"friendly concise message","actions":[{"type":"...", ...}]}

Action types (every action MUST include "type"):
- seed_defaults — restore default catalogue
- set_site_image { slot:"hero"|"fashion"|"maison"|"lifestyle"|"limited"|"manifesto", imageIndex:0 }
  Use for ANY homepage section image. Aliases: hero/header, fashion/mode, maison/home, lifestyle, limited/édition, manifesto.
- set_hero_image {imageIndex:0} — same as set_site_image slot hero
- set_fashion_image {imageIndex:0} — same as slot fashion
- set_site_text { key:"hero-subtitle", value:"New headline", lang:"fr"|"en"|"ar"|"all" }
  Change visible website copy. lang defaults to "all" (updates every language). HTML allowed in value where needed (<br>, <strong>, <em>).
- add_product {
    name, category, sub, price, stock, desc, featured, emoji,
    imageIndex OR imageIndices:[0,1],
    generateGallery:true,
    galleryShots:["prompt for shot 2","prompt for shot 3"]
  }
  ONLY for genuinely NEW catalogue items. When user attaches multiple different NEW items, return ONE add_product per item.
  Infer elegant French/Scandinavian product names, categories, prices (EUR), and rich descriptions from photos.
- replace_product_image / generate_product_images use Gemini Nano Banana image models (AI-generated photos).
- When user wants AI images + title/description for an EXISTING product, return:
  update_product { match:"focused", name, desc, price } AND generate_product_images { match:"focused", galleryShots:[...] }
  OR replace_product_image if they want to replace the main photo only.
- NEVER return add_product when user says "this product", "for this product", "change this product", or "replace this product image".
- When user attaches photos to ADD/SELL/LIST items (or does not clearly ask to change an existing one) → always add_product.

Example — user: "for this product make display images and add description and title"
→ actions: [
  {"type":"update_product","match":"focused","desc":"...","name":"..."},
  {"type":"generate_product_images","match":"focused","galleryShots":["flat lay...","detail...","lifestyle..."]}
]
NOT add_product.

Nano Banana (AI image generation) — use when user wants generated/catalog/lifestyle photos:
- replace_product_image { match:"focused"|"last"|name|id, prompt:"...", referenceImageIndex:0 }
  Replace the main product photo with one AI-generated Nano Banana image.
- generate_product_images { match:"focused"|"last"|name|id, referenceImageIndex:0, galleryShots:["flat lay...","detail...","lifestyle..."] }
  Add AI-generated gallery shots to an EXISTING product (Nano Banana). Keeps main image unless user asks to replace it.
- append_product_images {
    match:"product name" OR "focused" OR "last",
    imageIndices:[0,1,2],
    appendImages:true
  }
  Attach several uploaded photos to ONE existing product gallery (keeps existing images, adds new ones at the end).
- update_product { match or name, price, desc, stock, featured, imageIndex, imageIndices:[0,1], appendImages:true }
  appendImages:true when adding photos to an existing product without replacing the whole gallery.
- update_product_image { match or name, imageIndex OR imageIndices:[0,1,2], appendImages:true }
  appendImages:false replaces the main image only; true appends all uploads to the gallery.
- delete_product { match:"product name" OR "focused" OR id number }
- set_featured { ids:[1,4,7,9] }

Site image slots: ${JSON.stringify(siteImages)}.
Editable text keys (examples): ${JSON.stringify(textKeys)}.
Categories: Mode, Maison, Lifestyle, Édition limitée.
Subs: Vêtements, Canapés, Vaisselle, Déco, Textile, Sacs, Chaussures, Lampes.
Current products: ${JSON.stringify(products)}.
Recently touched in this chat: ${JSON.stringify(recent)}.
${focused ? 'Active product for "this product" / match:"focused" (photo match, last chat product, or open editor): ' + JSON.stringify(focused) + '.' : 'No active product yet — identify from attached photo, product name in the message, or recent chat.'}
User may write Swedish, French, English, or Arabic.
CRITICAL DEFAULT: any attached product photo without the exact words "this product" / "change this product" / "replace this image" MUST become add_product with a NEW catalogue entry. Never update or replace an existing product because the photo looks similar.
Never delete products unless the user says delete/remove.
Never reuse or overwrite an existing product id.`;
  }

  function parseAiJson(raw) {
    if (!raw) return { reply: '', actions: [] };
    const trimmed = String(raw).trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
      if (Array.isArray(parsed)) return { reply: '', actions: parsed };
      if (parsed.actions) return parsed;
      if (parsed.type) return { reply: parsed.reply || '', actions: [parsed] };
      return parsed;
    } catch (_) {
      return { reply: trimmed, actions: [] };
    }
  }

  function msg(key, fallback) {
    const v = L(key);
    return v && v !== key ? v : fallback;
  }

  function trimHistory() {
    if (chatHistory.length > MAX_HISTORY_TURNS) {
      chatHistory = chatHistory.slice(-MAX_HISTORY_TURNS);
    }
  }

  function serializeHistoryTurn(turn) {
    const out = {
      role: turn.role,
      text: turn.text,
      summary: turn.summary,
      includeImages: turn.includeImages,
    };
    if (turn.files && turn.files.length && turn.includeImages !== false) {
      out.files = turn.files.map((f) => ({ name: f.name, dataUrl: f.dataUrl }));
    }
    return out;
  }

  function collectUiMessages() {
    const box = $('adminAiMessages');
    if (!box) return [];
    return Array.from(box.querySelectorAll('.admin-ai-msg')).map((el) => ({
      role: el.classList.contains('admin-ai-msg--user') ? 'user' : 'assistant',
      html: el.innerHTML,
    }));
  }

  function buildSessionPayload(opts) {
    const noSnapshots = opts && opts.noSnapshots;
    const noFiles = opts && opts.noFiles;
    return {
      savedAt: Date.now(),
      expiresAt: Date.now() + HISTORY_TTL_MS,
      chatHistory: chatHistory.map((turn) => {
        const row = serializeHistoryTurn(turn);
        if (noFiles || turn.includeImages === false) delete row.files;
        return row;
      }),
      sessionCtx: {
        lastProductNames: sessionCtx.lastProductNames || [],
        focusedProductId: sessionCtx.focusedProductId,
        focusedProductName: sessionCtx.focusedProductName || '',
        adminVisibleIds: sessionCtx.adminVisibleIds || [],
      },
      turnSnapshots: noSnapshots
        ? []
        : turnSnapshots.slice(-MAX_PERSISTED_SNAPSHOTS).map((t) => ({
            id: t.id,
            before: slimSnapshotForStorage(t.before),
            after: slimSnapshotForStorage(t.after),
          })),
      messages: collectUiMessages(),
    };
  }

  function persistChatSession() {
    if (typeof sessionStorage === 'undefined') return;
    if (historySaveTimer) clearTimeout(historySaveTimer);
    historySaveTimer = setTimeout(() => {
      historySaveTimer = null;
      const attempts = [{}, { noSnapshots: true }, { noSnapshots: true, noFiles: true }];
      for (let i = 0; i < attempts.length; i++) {
        try {
          sessionStorage.setItem(HISTORY_KEY, JSON.stringify(buildSessionPayload(attempts[i])));
          return;
        } catch (e) {
          console.warn('admin ai history save', attempts[i], e);
        }
      }
      try {
        sessionStorage.removeItem(HISTORY_KEY);
      } catch (_) {}
    }, 250);
  }

  function clearExpiredChatSession() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.expiresAt && Date.now() > data.expiresAt) {
        sessionStorage.removeItem(HISTORY_KEY);
      }
    } catch (_) {
      try {
        sessionStorage.removeItem(HISTORY_KEY);
      } catch (e2) {}
    }
  }

  function restoreChatSession() {
    if (typeof sessionStorage === 'undefined') return false;
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.expiresAt || Date.now() > data.expiresAt) {
        sessionStorage.removeItem(HISTORY_KEY);
        return false;
      }

      chatHistory = (data.chatHistory || []).map((t) => ({
        role: t.role,
        text: t.text,
        summary: t.summary,
        includeImages: t.includeImages,
        files: t.files || [],
      }));
      markOlderImageTurns();

      if (data.sessionCtx) {
        sessionCtx.lastProductNames = data.sessionCtx.lastProductNames || [];
        sessionCtx.focusedProductId = data.sessionCtx.focusedProductId ?? null;
        sessionCtx.focusedProductName = data.sessionCtx.focusedProductName || '';
        sessionCtx.adminVisibleIds = data.sessionCtx.adminVisibleIds || [];
      }

      turnSnapshots = data.turnSnapshots || [];
      redoStack = [];

      const box = $('adminAiMessages');
      if (!box || !Array.isArray(data.messages) || !data.messages.length) return false;

      box.innerHTML = '';
      data.messages.forEach((m) => {
        const el = document.createElement('div');
        el.className = 'admin-ai-msg admin-ai-msg--' + (m.role === 'user' ? 'user' : 'assistant');
        el.innerHTML = sanitizeRestoredHtml(m.html);
        box.appendChild(el);
      });
      box.scrollTop = box.scrollHeight;

      data.expiresAt = Date.now() + HISTORY_TTL_MS;
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(data));
      updateFocusChip();
      return true;
    } catch (e) {
      console.warn('admin ai history restore', e);
      try {
        sessionStorage.removeItem(HISTORY_KEY);
      } catch (_) {}
    }
    return false;
  }

  function historyFilesForGemini(turn) {
    if (!turn.files || !turn.files.length) return [];
    return turn.includeImages === false ? [] : turn.files;
  }

  function buildGeminiContents() {
    const contents = [];
    chatHistory.forEach((turn) => {
      if (turn.role === 'user') {
        const parts = [{ text: turn.text || '(attached images)' }];
        historyFilesForGemini(turn).forEach((f, i) => {
          const imgPart = dataUrlToGeminiPart(f.dataUrl);
          if (imgPart) parts.push(imgPart);
          parts.push({ text: '[attachment ' + i + ': ' + (f.name || 'image') + ']' });
        });
        contents.push({ role: 'user', parts });
      } else if (turn.role === 'model') {
        contents.push({ role: 'model', parts: [{ text: turn.text || turn.summary || 'Done.' }] });
      }
    });
    return contents;
  }

  function addBubble(role, html) {
    const box = $('adminAiMessages');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'admin-ai-msg admin-ai-msg--' + role;
    el.innerHTML = html;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function setLastBubble(html) {
    const msgs = $('adminAiMessages');
    const last = msgs && msgs.lastElementChild;
    if (last) last.innerHTML = html;
  }

  /** Short status only — never dump prompts / JSON into the chat. */
  function photoProgressHtml(done, total) {
    const n = Math.max(0, Number(done) || 0);
    const t = Math.max(1, Number(total) || 1);
    const label = msg('admin-ai-photos-loading', 'example photos loading');
    return (
      '<span class="admin-ai-typing">' +
      esc(String(n) + '/' + String(t) + ' ' + label) +
      '</span>'
    );
  }

  function cleanCloudReply(reply, opts) {
    // Status lines only — never show Gemini chat fluff in the admin UI
    if (opts && opts.suppress) return '';
    let s = String(reply == null ? '' : reply).trim();
    if (!s) return '';
    if (/[\[{]\s*"?(?:type|actions|galleryShots|prompt|imageIndex)"?/i.test(s)) return '';
    if (/j.?ai (?:ajout|génér|mis|créé)|c.?est fait|je (?:m.?en occupe|génère|vais)/i.test(s)) return '';
    if (/flat lay|close-up|lifestyle|studio|photorealistic|catalog shot|mannequin|portant/i.test(s)) return '';
    s = s.replace(/\s+/g, ' ');
    if (s.length > 72) return '';
    return s;
  }

  function formatActionSummary(lines) {
    return (lines || [])
      .map((line) => String(line || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((line) => {
        // Keep done lines short if a model somehow leaked prompts into errors
        if (line.length > 160) return line.slice(0, 157).trim() + '…';
        return line;
      })
      .join('<br>');
  }

  function renderAttachments() {
    const row = $('adminAiAttachments');
    if (!row) return;
    if (!attachments.length) {
      row.innerHTML = '';
      row.hidden = true;
      return;
    }
    row.hidden = false;
    row.innerHTML = attachments
      .map(
        (a, i) =>
          `<div class="admin-ai-thumb"><img src="${esc(a.dataUrl)}" alt="" /><button type="button" data-i="${i}" aria-label="Remove">×</button></div>`
      )
      .join('');
    row.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        attachments.splice(parseInt(btn.dataset.i, 10), 1);
        renderAttachments();
      });
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const catalogImageDataUrlCache = new Map();

  function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().split('?')[0].split('#')[0];
  }

  async function urlToComparableDataUrl(url) {
    if (!url) return null;
    if (String(url).startsWith('data:')) return url;
    const key = normalizeImageUrl(url);
    if (catalogImageDataUrlCache.has(key)) return catalogImageDataUrlCache.get(key);

    // Prefer fetch (works for Firebase Storage when CORS is set)
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await readFileAsDataUrl(blob);
        catalogImageDataUrlCache.set(key, dataUrl);
        return dataUrl;
      }
    } catch (_) {}

    // Canvas fallback when fetch is blocked but the image still loads with CORS
    try {
      const dataUrl = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            if (!canvas.width || !canvas.height) {
              resolve(null);
              return;
            }
            canvas.getContext('2d').drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.92));
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
      if (dataUrl) {
        catalogImageDataUrlCache.set(key, dataUrl);
        return dataUrl;
      }
    } catch (_) {}

    return null;
  }

  async function imageFingerprint(dataUrl) {
    if (!dataUrl) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        resolve(ctx.getImageData(0, 0, size, size).data);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function compareImageSimilarity(a, b) {
    const dataA = String(a).startsWith('data:') ? a : await urlToComparableDataUrl(a);
    const dataB = String(b).startsWith('data:') ? b : await urlToComparableDataUrl(b);
    if (!dataA || !dataB) return 0;
    if (dataA === dataB || normalizeImageUrl(dataA) === normalizeImageUrl(dataB)) return 1;

    const fa = await imageFingerprint(dataA);
    const fb = await imageFingerprint(dataB);
    if (!fa || !fb || fa.length !== fb.length) return 0;

    let diff = 0;
    for (let i = 0; i < fa.length; i++) diff += Math.abs(fa[i] - fb[i]);
    return Math.max(0, 1 - diff / (fa.length * 255));
  }

  async function findCatalogImageIndex(product, attachmentDataUrl) {
    const images = S().normalizeProductImages(product);
    let bestIdx = 0;
    let bestScore = 0;
    for (let i = 0; i < images.length; i++) {
      const score = await compareImageSimilarity(attachmentDataUrl, images[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return { imageIndex: bestIdx, score: bestScore };
  }

  async function findProductByImageMatch(attachmentDataUrl) {
    if (!attachmentDataUrl) return null;
    const products = S().getProducts();
    let best = { product: null, imageIndex: 0, score: 0, method: '' };

    for (const product of products) {
      const images = S().normalizeProductImages(product);
      for (let i = 0; i < images.length; i++) {
        const catalogUrl = images[i];
        if (catalogUrl === attachmentDataUrl) {
          return { product, imageIndex: i, score: 1, method: 'exact' };
        }
        if (normalizeImageUrl(catalogUrl) && normalizeImageUrl(catalogUrl) === normalizeImageUrl(attachmentDataUrl)) {
          return { product, imageIndex: i, score: 1, method: 'url' };
        }
        const score = await compareImageSimilarity(attachmentDataUrl, catalogUrl);
        if (score > best.score) {
          best = { product, imageIndex: i, score, method: 'visual' };
        }
      }
    }

    return best.score >= 0.92 ? best : null;
  }

  async function identifyProductWithGemini(files, text) {
    const key = geminiKey();
    if (!key || !files.length) return null;

    const products = S()
      .getProducts()
      .slice(0, 40)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        sub: p.sub,
        desc: (p.desc || '').slice(0, 120),
        imageCount: S().normalizeProductImages(p).length,
      }));

    const parts = [
      {
        text:
          'The user attached a product/catalog photo from their shop admin. Identify which catalog product it belongs to and which gallery image index (0 = main) it matches.\n\n' +
          'User message: ' +
          (text || '(no text)') +
          '\n\nCatalog:\n' +
          JSON.stringify(products) +
          '\n\nReply ONLY JSON: {"productId":number|null,"imageIndex":number,"confidence":0.0-1.0,"reason":"brief"}',
      },
    ];
    const ref = dataUrlToGeminiPart(files[0].dataUrl);
    if (ref) parts.push(ref);

    const models = chatModels().slice(0, 4);
    for (const model of models) {
      const url = geminiModelUrl(model);
      try {
        throwIfCancelled();
        const res = await fetch(url, geminiFetchOptions(key, { contents: [{ parts }] }, activeAbort && activeAbort.signal));
        if (!res.ok) continue;
        const data = await res.json();
        const raw =
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts &&
          data.candidates[0].content.parts.map((p) => p.text).join('');
        const parsed = parseAiJson(raw);
        const id = parsed.productId != null ? parseInt(parsed.productId, 10) : null;
        const confidence = Number(parsed.confidence);
        if (!id || !Number.isFinite(confidence) || confidence < 0.85) return null;
        return {
          productId: id,
          imageIndex: parsed.imageIndex != null ? parseInt(parsed.imageIndex, 10) : 0,
          confidence: confidence,
          reason: parsed.reason || '',
        };
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  async function resolveProductFromAttachments(files, text) {
    if (!files || !files.length) return null;

    const attachment = files[0].dataUrl;
    const visual = await findProductByImageMatch(attachment);
    if (visual && visual.product) {
      const refined = await findCatalogImageIndex(visual.product, attachment);
      if (refined.score >= 0.75) visual.imageIndex = refined.imageIndex;
      return visual;
    }

    if (hasCloudAI()) {
      const vision = await identifyProductWithGemini(files, text);
      if (vision && vision.productId) {
        const product = S().getProducts().find((p) => p.id === vision.productId);
        if (product) {
          const refined = await findCatalogImageIndex(product, attachment);
          const imageIndex =
            refined.score >= 0.75 ? refined.imageIndex : Math.max(0, vision.imageIndex || 0);
          return {
            product,
            imageIndex,
            score: vision.confidence,
            method: 'gemini',
          };
        }
      }
    }

    return null;
  }

  function normalizeUserIntentText(text) {
    return String(text || '')
      .replace(/^(?:no[,!\s—-]+|not\s+that[,!\s—-]+|don'?t\s+(?:do\s+that[,!\s—-]+)?)/i, '')
      .trim();
  }

  function getRecentChatFiles() {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const turn = chatHistory[i];
      if (turn.role === 'user' && turn.files && turn.files.length) {
        return turn.files;
      }
    }
    return sessionCtx.lastFiles && sessionCtx.lastFiles.length ? sessionCtx.lastFiles : [];
  }

  function getEffectiveFiles(files, text) {
    const current = files && files.length ? files : [];
    if (current.length) return current;
    const t = normalizeUserIntentText(text).toLowerCase();
    if (
      wantsCreateOrGenerateImage(text) ||
      refersAttachedImageEdit(text, sessionCtx.lastFiles || []) ||
      /(?:this|that|the)\s+(?:image|photo|model|picture|one)\b/.test(t) ||
      /(?:same|attached|uploaded)\s+(?:image|photo)/.test(t) ||
      /^(?:yes|ok|okay|do it|go ahead|please)\b/.test(t)
    ) {
      return getRecentChatFiles();
    }
    return current;
  }

  function wantsCreateOrGenerateImage(text) {
    const t = normalizeUserIntentText(text).toLowerCase();
    if (!t) return false;
    if (/(?:new\s+)?products?\b/.test(t) && !/(?:image|photo|picture|bild|model)/.test(t)) return false;
    return (
      /(?:create|generate|make|produce|build|créer|générer|skapa)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:images?|photos?|pictures?|bilder?|shot|variant|version)/.test(t) ||
      /(?:new|another|different)\s+(?:images?|photos?|pictures?|catalog\s+image)/.test(t) ||
      /(?:ai|nano|banana)\s+(?:images?|photos?)/.test(t) ||
      /(?:images?|photos?)\s+(?:with\s+ai|using\s+ai)/.test(t)
    );
  }

  function refersAttachedImageEdit(text, files) {
    const imgs = files && files.length ? files : getRecentChatFiles();
    if (!imgs.length) return false;
    if (userWantsAddProduct(text, imgs)) return false;
    if (wantsMultipleDifferentProducts(text, imgs)) return false;
    if (inferSiteImageSlot(text)) return false;
    // Only true for clear edit-of-existing-image language
    return userExplicitlyWantsMutateExisting(text);
  }

  function buildImageEditPrompt(text) {
    const raw = normalizeUserIntentText(text).trim();
    if (!raw) return '';
    const stripped = raw
      .replace(
        /^(?:please\s+)?(?:(?:no[,!\s—-]+\s*)?(?:create|generate|make|change|replace|update|edit|retouch)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:this\s+)?(?:model|image|photo|picture|shot)?\s*(?:to|with|instead|so|:)?\s*)/i,
        ''
      )
      .trim();
    const body = stripped.length >= 8 ? stripped : raw;
    return (
      body +
      '. Keep the same garment/product as the reference photo. Professional e-commerce catalog quality, photorealistic, no text or watermarks.'
    );
  }

  function buildImageGenerateAction(text, imgs) {
    const productRef =
      sessionCtx.resolvedProductId != null || sessionCtx.focusedProductId != null || getActiveProduct()
        ? 'focused'
        : 'last';
    const modelShot = wantsModelWear(text);
    if (modelShot) {
      return {
        type: 'generate_product_images',
        match: productRef,
        referenceImageIndex: 0,
        replaceGallery: false,
        galleryShots: modelWearGalleryShots(text),
        useUploadedReference: !!(imgs && imgs.length),
      };
    }
    return {
      type: 'replace_product_image',
      match: productRef,
      prompt:
        buildImageEditPrompt(text) ||
        'Fresh professional e-commerce catalog photo of the same product, new angle, lighting, and Scandinavian minimal styling',
      referenceImageIndex: 0,
      catalogImageIndex: sessionCtx.resolvedImageIndex != null ? sessionCtx.resolvedImageIndex : 0,
      useUploadedReference: !!(imgs && imgs.length),
    };
  }

  async function compressImage(dataUrl, maxEdge, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const cap = maxEdge || AI_ATTACH_MAX_EDGE;
        const long = Math.max(w, h);
        const q = quality != null ? quality : 0.9;
        // Already within size budget and high-quality JPEG — keep the original bytes
        if (long <= cap && String(dataUrl).startsWith('data:image/jpeg') && q >= 0.9) {
          resolve(dataUrl);
          return;
        }
        if (long > cap) {
          const scale = cap / long;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', q));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    for (const file of files) {
      if (attachments.length >= MAX_ATTACH) break;
      if (file.size > MAX_IMAGE_BYTES) {
        addBubble('assistant', msg('admin-ai-err-size', 'Image too large (max 12 MB).'));
        continue;
      }
      let dataUrl = await readFileAsDataUrl(file);
      dataUrl = await compressImage(dataUrl, AI_ATTACH_MAX_EDGE, 0.82);
      attachments.push({ name: file.name, dataUrl });
    }
    renderAttachments();
  }

  function nextProductId(products) {
    const ids = (products || [])
      .map((p) => Number(p && p.id))
      .filter((n) => Number.isFinite(n) && n > 0);
    const maxId = ids.length ? Math.max.apply(null, ids) : 0;
    // Timestamp-based floor so a stale/partial local cache cannot reuse an existing cloud id
    const uniqueFloor = Math.floor(Date.now() / 1000);
    return Math.max(maxId + 1, uniqueFloor);
  }

  function findProductByName(name) {
    const raw = String(name || '').trim();
    const q = raw.toLowerCase();
    if (!raw || q === 'last' || q === 'dernier' || q === 'senaste') {
      const last = sessionCtx.lastProductNames[sessionCtx.lastProductNames.length - 1];
      return last ? findProductByName(last) : null;
    }
    const products = S().getProducts();
    if (/^\d+$/.test(raw)) {
      const byId = products.find((p) => p.id === parseInt(raw, 10));
      if (byId) return byId;
    }
    // Exact / case-insensitive only — fuzzy includes caused wrong product updates
    return (
      products.find((p) => p.name === raw) ||
      products.find((p) => String(p.name || '').toLowerCase() === q) ||
      null
    );
  }

  function readEditorProduct() {
    try {
      const el = $('editId');
      if (!el || !el.value) return null;
      const id = parseInt(el.value, 10);
      if (!Number.isFinite(id)) return null;
      return S().getProducts().find((p) => p.id === id) || null;
    } catch (_) {
      return null;
    }
  }

  /** Product for "this product" / match:"focused" — photo match, chat memory, or open editor. */
  function getActiveProduct() {
    const products = S().getProducts();
    if (sessionCtx.resolvedProductId != null) {
      const hit = products.find((p) => p.id === sessionCtx.resolvedProductId);
      if (hit) return hit;
    }
    if (sessionCtx.focusedProductId != null) {
      const hit = products.find((p) => p.id === sessionCtx.focusedProductId);
      if (hit) return hit;
    }
    if (sessionCtx.focusedProductName) {
      const byName = findProductByName(sessionCtx.focusedProductName);
      if (byName) return byName;
    }
    const editor = readEditorProduct();
    if (editor) return editor;
    const last = sessionCtx.lastProductNames[sessionCtx.lastProductNames.length - 1];
    if (last) {
      const byLast = findProductByName(last);
      if (byLast) return byLast;
    }
    return null;
  }

  function findProductFromContext(match, text) {
    const products = S().getProducts();

    if (sessionCtx.resolvedProductId != null) {
      const resolved = products.find((p) => p.id === sessionCtx.resolvedProductId);
      if (resolved) return resolved;
    }

    const q = String(match || '')
      .trim()
      .toLowerCase();
    const refersThis =
      q === 'focused' ||
      q === 'this' ||
      q === 'current' ||
      q === 'editor' ||
      /(?:change|update|edit|modify|replace)\s+this\b/i.test(text || '') ||
      /this product|den här produkten|det här|ce produit|cette produit|le produit|denna produkt|change this|update this|modifier ce|ändra den/i.test(
        text || ''
      ) ||
      /\bthis\s+(?:model|image|photo|picture|shot)\b/i.test(text || '');

    if (refersThis) {
      const active = getActiveProduct();
      if (active) return active;
    }

    const nameMatch =
      String(text || '').match(/(?:product|produkt|produit)\s+["']([^"']+)["']/i) ||
      String(text || '').match(/(?:named?|called|namn|nom)\s+["']?([^"'\n.]+?)["']?(?:\s|$)/i);
    if (nameMatch && nameMatch[1]) {
      const byQuoted = findProductByName(nameMatch[1].trim());
      if (byQuoted) return byQuoted;
    }

    const byName = findProductByName(match);
    if (byName) return byName;

    // No silent "only one product in list" fallbacks — those caused wrong overwrites
    return null;
  }

  function updateFocusChip() {
    const el = $('adminAiFocus');
    if (!el) return;
    // Prefer last AI-targeted product over whatever is open in the editor
    let id = sessionCtx.focusedProductId;
    let name = sessionCtx.focusedProductName;
    if (id == null) {
      const active = getActiveProduct();
      id = active ? active.id : null;
      name = active ? active.name : '';
    } else if (!name) {
      const hit = (S().getProducts() || []).find((p) => Number(p.id) === Number(id));
      name = hit ? hit.name : '';
    }
    if (id == null || !name) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg('admin-ai-focus', 'Target: ') + name + ' (#' + id + ')';
  }

  function setAdminListContext(ctx) {
    sessionCtx.adminVisibleIds = Array.isArray(ctx && ctx.visibleIds) ? ctx.visibleIds.slice() : [];
  }

  function getFocusedProductId() {
    const active = getActiveProduct();
    return active ? active.id : sessionCtx.focusedProductId;
  }

  function setFocusedProduct(id, name) {
    sessionCtx.focusedProductId = id != null ? parseInt(id, 10) : null;
    sessionCtx.focusedProductName = name ? String(name) : '';
    if (name) trackProduct(name);
    updateFocusChip();
    persistChatSession();
  }

  function wantsImagesOnOneProduct(text, files) {
    const t = String(text || '').toLowerCase();
    const n = (files || []).length;
    if (!n) return false;

    if (
      /(?:different|separate|distinct|several|multiple|various|olika|plusieurs|différents?)\s+(?:products?|produits?|produkter?|items?)/.test(
        t
      )
    ) {
      return false;
    }
    if (
      /(?:each|every)\s+(?:photo|image|picture|bild).*(?:is\s+)?(?:a\s+)?(?:new\s+)?(?:products?|produits?|items?)/.test(t) &&
      !/same\s+product/.test(t)
    ) {
      return false;
    }
    if (/(?:products?|produits?|items?).*(?:from each|each photo|per photo|per image|one per)/.test(t)) {
      return false;
    }
    if (/(?:these|those)\s+(?:are\s+)?(?:different|separate|new)\s+(?:products?|items?)/.test(t)) {
      return false;
    }

    if (
      /(?:images?|photos?|bilder|bild).*(?:to|for|on|à|sur|på).*(?:this|same|one|focused|the)\s*product/.test(t) ||
      /\b(?:this|the|same|one)\s+product\b/.test(t) ||
      /(?:all|these|every)\s+(?:images?|photos?|bilder).*(?:to|for|on)\s+(?:this|one|same|product)/.test(t) ||
      /(?:add|attach|upload|append).*(?:all|these).*(?:images?|photos?).*(?:to|on)/.test(t)
    ) {
      return true;
    }

    // Do NOT treat "last touched product" as gallery-on-one — that hijacks new adds.
    return false;
  }

  function wantsMultipleDifferentProducts(text, files) {
    const t = String(text || '').toLowerCase();
    const n = (files || []).length;
    if (n <= 1) return false;
    if (wantsImagesOnOneProduct(text, files)) return false;

    if (
      /(?:different|separate|distinct|several|multiple|various|olika|plusieurs|différents?)\s+(?:products?|produits?|produkter?|items?)/.test(
        t
      ) ||
      /(?:each|every)\s+(?:photo|image|picture|bild).*(?:is\s+)?(?:a\s+)?(?:new\s+)?(?:products?|produits?|items?)/.test(t) ||
      /(?:products?|produits?|items?).*(?:from each|each photo|per photo|per image|one per)/.test(t) ||
      /(?:add|create|list|publish|lägg till|ajouter|créer)\s+(?:these|those|all|each)\s+(?:as\s+)?(?:separate\s+)?(?:products?|produits?|items?)/.test(
        t
      ) ||
      /(?:these|those)\s+(?:are\s+)?(?:different|separate|new)\s+(?:products?|produits?|items?)/.test(t) ||
      /(?:as|into)\s+(?:products?|produits?|items?|catalog(?:ue)?)/.test(t) ||
      /(?:rings?|items?|pieces?|products?)\s+as\s+products?/.test(t)
    ) {
      return true;
    }

    if (
      explicitWantsNewProduct(text) ||
      (/(?:add|create|list|publish|catalog|shop|boutique|lägg till|ajouter)/.test(t) &&
        !/\bthis\s+product\b/.test(t) &&
        !/same\s+product/.test(t))
    ) {
      return true;
    }

    if (n > 1 && !userExplicitlyWantsMutateExisting(text)) {
      // Several photos without "this product" language → separate new listings
      return true;
    }

    return wantsCreateMultipleProducts(text, files);
  }

  /** True only for unmistakable edit/delete-of-existing wording. */
  function userExplicitlyWantsMutateExisting(text) {
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    if (inferSiteImageSlot(text)) return false;
    // Any clear "add/create new product" phrasing wins — never treat as mutate
    if (
      /(?:add|create|make|build|ajoute|ajouter|lägg(?:\s+till)?|skapa|créer|cree|new)\b/.test(t) &&
      /(?:products?|produits?|produkter?|items?|listings?|artikel|articles?)/.test(t)
    ) {
      return false;
    }
    if (/\bnew products?\b/.test(t) || /\bnouveau produits?\b/.test(t) || /\bny(?:a)? produkter?\b/.test(t)) {
      return false;
    }
    if (wantsModelWear(t) && !/(?:add|create|make|build).*(?:new\s+)?(?:products?|produits?)/.test(t)) return true;
    return (
      /\bthis\s+product\b/.test(t) ||
      /(?:den\s+här|denna)\s+produkten?\b/.test(t) ||
      /(?:ce|cette)\s+produit\b/.test(t) ||
      /(?:for|on|to)\s+this\s+product\b/.test(t) ||
      /(?:change|update|edit|modify|fix|replace|swap)\s+this\s+product\b/.test(t) ||
      /(?:change|replace|swap|update)\s+(?:the\s+)?(?:existing\s+)?(?:product\s+)?(?:image|photo|picture|bild)\b/.test(t) &&
        /(?:this|existing|current|focused)\b/.test(t) ||
      /(?:delete|remove)\s+(?:this\s+)?(?:product|item|produit|produkt)\b/.test(t) ||
      /(?:same|existing|current)\s+product\b/.test(t) ||
      /(?:didn.?t|doesn.?t|not).*(?:model|mannequin|wear|image|photo)/.test(t)
    );
  }

  /**
   * Force ADD whenever photos are attached (unless user clearly edits an existing product).
   * This is the primary safety switch against overwriting catalogue rows.
   */
  function userWantsAddProduct(text, files) {
    if (inferSiteImageSlot(text)) return false;
    if (wantsModelWear(text) && !explicitWantsNewProduct(text)) return false;
    if (userExplicitlyWantsMutateExisting(text)) return false;
    if (explicitWantsNewProduct(text)) return true;
    // Only THIS message's fresh attachments default to add — not carried chat photos
    const fresh = files && files.length ? files : [];
    if (fresh.length) return true;
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    return (
      /(?:add|create|make|build|ajoute|ajouter|lägg(?:\s+till)?|skapa|créer|cree|publish|list)\b/.test(t) &&
      /(?:products?|produits?|produkter?|items?|listings?)/.test(t)
    );
  }

  function shouldForceAddProducts(text, files) {
    return (
      userWantsAddProduct(text, files) ||
      explicitWantsNewProduct(text) ||
      wantsMultipleDifferentProducts(text, files)
    );
  }

  function actionToAddProduct(action) {
    if (!action) return null;
    return {
      type: 'add_product',
      name: action.name && !/^new product/i.test(String(action.name)) ? action.name : undefined,
      category: action.category,
      sub: action.sub,
      price: action.price,
      stock: action.stock,
      desc: action.desc || action.description,
      featured: action.featured,
      emoji: action.emoji,
      imageIndex:
        action.imageIndex != null
          ? action.imageIndex
          : action.referenceImageIndex != null
            ? action.referenceImageIndex
            : 0,
      imageIndices: action.imageIndices,
      generateGallery: false,
      galleryShots: [],
    };
  }

  function sanitizeActionsForAddMode(actions, text, files) {
    if (!shouldForceAddProducts(text, files)) return actions || [];
    const site = [];
    const addsByKey = new Map();
    const model = wantsModelWear(text);
    const mergeAdd = (key, action) => {
      if (!action) return;
      const prev = addsByKey.get(key);
      const next = {
        ...(prev || {}),
        ...action,
        type: 'add_product',
        name: preferProductName(action.name, prev && prev.name),
        category: action.category || (prev && prev.category),
        sub: action.sub || (prev && prev.sub),
        price: action.price != null ? action.price : prev && prev.price,
        stock: action.stock != null ? action.stock : prev && prev.stock,
        desc: action.desc || action.description || (prev && (prev.desc || prev.description)) || '',
        imageIndex: action.imageIndex != null ? action.imageIndex : prev && prev.imageIndex,
        imageIndices: action.imageIndices || (prev && prev.imageIndices),
      };
      if (model || action.generateGallery || (action.galleryShots && action.galleryShots.length)) {
        next.generateGallery = true;
        next.galleryShots =
          (model ? modelWearGalleryShots(text) : null) ||
          action.galleryShots ||
          action.shots ||
          (prev && prev.galleryShots) ||
          defaultGalleryShots(text);
      } else {
        next.generateGallery = false;
        next.galleryShots = [];
      }
      addsByKey.set(key, next);
    };

    (actions || []).forEach((action) => {
      if (!action || !action.type) return;
      const type = String(action.type);
      if (
        type === 'set_site_image' ||
        type === 'set_site_text' ||
        type === 'set_hero_image' ||
        type === 'set_fashion_image' ||
        type === 'set_featured'
      ) {
        site.push(action);
        return;
      }
      if (type === 'delete_product' || type === 'seed_defaults') return;

      if (type === 'add_product') {
        const key = action.imageIndex != null ? 'i' + action.imageIndex : 'solo';
        mergeAdd(key, action);
        return;
      }

      if (
        /^(update_product|replace_product_image|regenerate_product_image|generate_product_images|update_product_image|append_product_images)$/.test(
          type
        )
      ) {
        // Never spawn a second catalogue row — fold image work into the add
        const idx =
          action.imageIndex != null
            ? action.imageIndex
            : action.referenceImageIndex != null
              ? action.referenceImageIndex
              : 0;
        const key = files && files.length > 1 ? 'i' + idx : 'solo';
        const base = actionToAddProduct(action) || { type: 'add_product', imageIndex: idx };
        if (type === 'generate_product_images' || type === 'replace_product_image' || type === 'regenerate_product_image') {
          base.generateGallery = true;
          base.galleryShots =
            (model ? modelWearGalleryShots(text) : null) ||
            action.galleryShots ||
            action.shots ||
            defaultGalleryShots(text);
          if (type !== 'generate_product_images' && action.prompt) {
            base.galleryShots = [action.prompt].concat(base.galleryShots || []).slice(0, MAX_GALLERY_SHOTS);
          }
        }
        mergeAdd(key, base);
      }
    });

    const adds = Array.from(addsByKey.values());
    if (!adds.length && (files || []).length) {
      return site.concat(buildAddProductActions(text, files, { generateGallery: model }));
    }
    if (model) {
      adds.forEach((a) => {
        a.generateGallery = true;
        a.galleryShots = modelWearGalleryShots(text);
      });
    }
    return site.concat(adds);
  }

  function refersExistingProduct(text, files) {
    // Strict: only existing-product language counts. Never because a photo "looks similar".
    if (userWantsAddProduct(text, files)) return false;
    return userExplicitlyWantsMutateExisting(text);
  }

  function wantsFocusedProductImageEdit(text) {
    if (!getActiveProduct()) return false;
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    if (inferSiteImageSlot(text)) return false;
    // Never treat "make/add a new product" as editing the open product
    if (explicitWantsNewProduct(text)) return false;
    if (wantsModelWear(text)) return true;
    return (
      /^(?:the\s+)?(?:image|photo|picture|model|shot|clothes?|garment)\s*\.?$/.test(t) ||
      /(?:change|replace|swap|update|different|another)\s+(?:the\s+)?(?:model|mannequin|photo|image|picture|shot)/.test(t) ||
      /(?:change|update|edit|modify)\s+this\s+product\b/.test(t) ||
      /(?:change|update|edit|modify)\s+this\b/.test(t) ||
      /(?:model|mannequin|portrait)\s+(?:for|of|on|with)/.test(t) ||
      /(?:for|of)\s+(?:the\s+)?(?:clothes?|clothing|garment|outfit|product)/.test(t) ||
      /(?:clothes?|clothing|garment|outfit).*(?:model|image|photo)/.test(t) ||
      /(?:change|replace).*(?:clothes?|clothing|garment|model)/.test(t) ||
      /\bthis\s+(?:model|image|photo|product)\b/.test(t) ||
      /(?:didn.?t|doesn.?t|not).*(?:model|mannequin|wear)/.test(t)
    );
  }

  function wantsModelWear(text) {
    const t = normalizeUserIntentText(text).toLowerCase();
    if (!t) return false;
    return (
      /(?:model|mannequin|modèle|modele)\b/.test(t) ||
      /(?:wear(?:ing)?|worn|portant|porter|porte|habill)/.test(t) ||
      /(?:on\s+(?:a\s+)?(?:model|mannequin)|with\s+(?:a\s+)?(?:model|mannequin))/.test(t) ||
      /(?:full[\s-]?body|lookbook|editorial)/.test(t)
    );
  }

  function modelWearPrompt(text) {
    const extra = normalizeUserIntentText(text).trim();
    const detail =
      extra && !/^(?:yes|ok|okay|please|do it|go ahead)\b/i.test(extra)
        ? ' User request: ' + extra.slice(0, 200) + '.'
        : '';
    return (
      'Professional fashion model wearing the exact same garment/outfit from the reference photo. ' +
      'Full-body e-commerce catalog shot, natural pose, Scandinavian minimal styling, soft daylight, ' +
      'clean studio or bright interior, photorealistic, no text or watermarks.' +
      detail
    );
  }

  function modelWearGalleryShots(text) {
    return [
      modelWearPrompt(text),
      'Same garment on a fashion model, three-quarter angle, full outfit visible, soft Nordic light, catalog quality',
    ].slice(0, MAX_GALLERY_SHOTS);
  }

  function isGenericProductName(name) {
    const n = String(name || '').trim();
    return !n || /^new product(\s+[\d\- :]+)?$/i.test(n) || /^product \d+$/i.test(n);
  }

  function preferProductName(a, b) {
    if (!isGenericProductName(a) && isGenericProductName(b)) return a;
    if (!isGenericProductName(b) && isGenericProductName(a)) return b;
    if (a && b) return String(a).length >= String(b).length ? a : b;
    return a || b || 'New product';
  }

  function defaultGalleryShots(text) {
    if (wantsModelWear(text)) return modelWearGalleryShots(text);
    const t = String(text || '').toLowerCase();
    const clothing = /cloth|clothing|vetement|vêtement|robe|dress|ensemble|outfit|child|kid|mode|fashion/.test(t);
    if (clothing) {
      return [
        modelWearPrompt(text),
        'Same garment flat lay on cream linen, full item visible, soft natural light',
      ].slice(0, MAX_GALLERY_SHOTS);
    }
    return [
      'Same product as reference, professional Scandinavian e-commerce flat lay on neutral background, soft natural light',
      'Close-up detail shot of material texture, same product',
    ].slice(0, MAX_GALLERY_SHOTS);
  }

  function convertAddToExistingActions(action, text, files, intent) {
    // Hard rule: never rewrite add → update when photos mean "new listing"
    if (shouldForceAddProducts(text, files)) return null;
    if (userWantsAddProduct(text, files)) return null;
    if (wantsMultipleDifferentProducts(text, files)) return null;
    if (!userExplicitlyWantsMutateExisting(text)) return null;

    const match =
      action.match ||
      (refersExistingProduct(text, files) ? 'focused' : action.name || 'last');
    const refIdx = action.imageIndex != null ? action.imageIndex : 0;
    const out = [];
    const tl = String(text || '').toLowerCase();

    const wantsAi =
      intent.wantsAiGenerate ||
      intent.wantsGallery ||
      action.generateGallery ||
      /(?:generate|make|create|nano|banana|ai)\b/.test(tl) ||
      /(?:other|more|extra|display|additional)\s+(?:images?|photos?)/.test(tl);

    const wantsReplaceMain =
      /(?:replace|change|swap)\s+(?:the\s+)?(?:main\s+)?(?:image|photo|picture|bild)/.test(tl) ||
      /(?:different|another|new)\s+(?:main\s+)?(?:image|photo|bild)/.test(tl);

    if (action.name || action.desc || action.description) {
      const genericName = /^new product(\s+\d+)?$/i.test(String(action.name || '').trim());
      if ((action.name && !genericName) || action.desc || action.description) {
        out.push({
          type: 'update_product',
          match,
          name: genericName ? undefined : action.name,
          desc: action.desc || action.description,
          price: action.price,
          stock: action.stock,
          featured: action.featured,
        });
      }
    }

    if (wantsAi && !wantsReplaceMain) {
      out.push({
        type: 'generate_product_images',
        match,
        referenceImageIndex: refIdx,
        galleryShots: action.galleryShots || action.shots || defaultGalleryShots(text),
      });
      return out;
    }

    if (wantsAi || wantsReplaceMain) {
      out.push({
        type: 'replace_product_image',
        match,
        prompt: action.prompt || action.desc || action.description || text,
        referenceImageIndex: refIdx,
        useUploadedReference: !!action.useUploadedReference,
      });
      return out;
    }

    if (intent.wantsAppendToOne && files && files.length > 1) {
      out.push({
        type: 'append_product_images',
        match,
        imageIndices:
          Array.isArray(action.imageIndices) && action.imageIndices.length
            ? action.imageIndices
            : files.map((_, i) => i),
      });
      return out;
    }

    if (userExplicitlyWantsMutateExisting(text)) {
      if (files && files.length) {
        out.push({
          type: 'update_product_image',
          match,
          imageIndex: refIdx,
          appendImages: files.length > 1,
          imageIndices: files.length > 1 ? files.map((_, i) => i) : undefined,
        });
      } else if (action.desc || action.description || action.name) {
        out.push({
          type: 'update_product',
          match,
          name: action.name,
          desc: action.desc || action.description,
          price: action.price,
        });
      }
      return out.length ? out : null;
    }

    return null;
  }

  function explicitWantsNewProduct(text) {
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    // Image-only generate phrasing without product words is not "new product"
    if (wantsCreateOrGenerateImage(text) && !/(?:products?|produits?|produkter?|items?|listings?)/.test(t)) {
      return false;
    }
    if (userExplicitlyWantsMutateExisting(text)) return false;
    if (
      /(?:hero|header|site|section|manifesto|fashion card|mode card)/.test(t) &&
      !/(?:products?|produits?|produkter?|items?)/.test(t)
    ) {
      return false;
    }
    if (/(?:this|the|same|focused|den här|ce|cette)\s+product/.test(t) && !/(?:new|add|create|another product)/.test(t)) {
      return false;
    }
    return (
      /(?:add|create|make|build|lägg till|ajouter|créer|skapa|ny)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:products?|produits?|produkter?|items?|listings?)/.test(
        t
      ) ||
      /\b(?:a\s+|an\s+|the\s+)?new products?\b/.test(t) ||
      /(?:add|make|create|lägg till).*(?:shop|catalog|boutique|inventory|sortiment)/.test(t) ||
      /(?:list|publish|catalogue|catalog).*(?:as\s+)?(?:products?|items?|listings?)/.test(t) ||
      /(?:these|those|all|each|every|both)\s+(?:as\s+)?(?:products?|items?|listings?)/.test(t)
    );
  }

  function inferSiteImageSlot(text) {
    const t = String(text || '').toLowerCase();
    if (/hero|header|startbild|huvudbild|top of (the )?(page|site)|homepage banner/.test(t)) return 'hero';
    if (/(?:fashion|mode)\s*(?:card|section|collection)|where it says (?:fashion|mode)|där det står (?:mode|fashion)/.test(t)) {
      return 'fashion';
    }
    if (/maison|home card|home section/.test(t) && !/product|produit|produkt/.test(t)) return 'maison';
    if (/lifestyle\s*(?:card|section)/.test(t)) return 'lifestyle';
    if (/limited|édition|edition limitee/.test(t) && !/product|produit|produkt/.test(t)) return 'limited';
    if (/manifesto/.test(t)) return 'manifesto';
    return null;
  }

  function wantsSiteImageChange(text, files) {
    return !!(files && files.length && inferSiteImageSlot(text));
  }

  function rewriteMisclassifiedActions(actions, text, files) {
    const intent = classifyIntent(text, files);
    const siteSlot = inferSiteImageSlot(text);
    const out = [];

    (actions || []).forEach((action) => {
      if (!action || !action.type) return;

      if (action.type === 'add_product') {
        if (siteSlot || wantsSiteImageChange(text, files)) {
          out.push({
            type: 'set_site_image',
            slot: siteSlot || inferSiteImageSlot(text) || 'hero',
            imageIndex: action.imageIndex != null ? action.imageIndex : 0,
          });
          return;
        }
        if (userWantsAddProduct(text, files)) {
          out.push(action);
          return;
        }
        const converted = convertAddToExistingActions(action, text, files, intent);
        if (converted) {
          converted.forEach((a) => out.push(a));
          return;
        }
        // Prefer keeping a new product over silently dropping the action
        out.push(action);
        return;
      }

      // Never invent deletes
      if (action.type === 'delete_product' && !/(?:delete|remove|ta bort|supprimer)/i.test(String(text || ''))) {
        return;
      }

      out.push(action);
    });

    return out;
  }

  function wantsCreateMultipleProducts(text, files) {
    const t = String(text || '').toLowerCase();
    const imgs = files || [];
    const n = imgs.length;
    if (!n) return false;

    if (
      /(?:images?|photos?|bilder|bild).*(?:to|for|on|à|sur|på).*(?:this|same|one|focused|the product|ce produit)/.test(
        t
      )
    ) {
      return false;
    }
    if (/(?:this|same|one)\s+product/.test(t) && !/(?:two|three|four|\d+|several|multiple|different|separate)\s+products?/.test(t)) {
      return false;
    }

    const addVerb = /(?:add|create|lägg till|ajouter|créer|new|make|publish|list)\b/.test(t);
    const productWord = /(?:products?|produits?|produkter?|items?|articles?)/.test(t);
    const multiCue =
      /(?:these|those|all|each|every|both|samtliga|toutes?|ces|deux|trois)\b/.test(t) ||
      /(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:products?|produits?|produkter?|items?)/.test(
        t
      ) ||
      /(?:products?|produits?|produkter?|items?).*(?:from each|each photo|per photo|per image)/.test(t) ||
      /add\s+(?:these|those|all|both|two|three|four|\d+)/.test(t);

    return addVerb && productWord && (multiCue || n > 1);
  }

  function extractNewProductName(text, index, total) {
    const raw = String(text || '').trim();
    const named =
      raw.match(/(?:named?|called|namn|nommé|nommee|nom)\s*[:\-]?\s*["']?([^"'\n,.]+?)["']?(?:\s*$|[.,])/i) ||
      raw.match(
        /(?:add|create|make|build|lägg till|ajouter|créer|skapa)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:products?|produits?|produkter?|items?)\s+(?:called|named|namn|nom)\s+["']?([^"'\n,.]+)/i
      );
    if (named && named[1] && named[1].trim().length >= 2) return named[1].trim().slice(0, 80);
    // Strip command phrasing; leftover can be a title like "make a new product Linen Dress"
    const stripped = raw
      .replace(
        /^(?:please\s+)?(?:add|create|make|build|lägg till|ajouter|créer|skapa)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:products?|produits?|produkter?|items?)\s*/i,
        ''
      )
      .replace(/^(?:called|named|namn|nom)\s+/i, '')
      .trim();
    if (stripped && !/^(?:please|thanks|now|here|this|from|with|using)\b/i.test(stripped) && stripped.length >= 2) {
      return stripped.slice(0, 80);
    }
    if (total > 1) return 'New product ' + (index + 1);
    return 'New product';
  }

  function buildAddProductActions(text, files, opts) {
    const imgs = files || [];
    const t = String(text || '').toLowerCase();
    const priceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kr|€|eur|sek)?/i);
    const catMatch = text.match(/\b(mode|maison|lifestyle|fashion|home|édition limitée|edition limitee)\b/i);
    const wantsGallery =
      (opts && opts.generateGallery) ||
      wantsModelWear(text) ||
      /(?:generate|make|create).*(?:gallery|display images|more images|extra images)|(?:ai|nano)\s+gallery/.test(t);

    const targets = imgs.length ? imgs : [null];
    return targets.map((_, i) => ({
      type: 'add_product',
      name: extractNewProductName(text, i, targets.length),
      category: catMatch ? catMatch[1] : 'Mode',
      price: priceMatch ? parseFloat(String(priceMatch[1]).replace(',', '.')) : null,
      stock: 5,
      desc: '',
      imageIndex: imgs.length ? i : undefined,
      generateGallery: !!(wantsGallery && (imgs.length <= 1 || targets.length === 1)),
      galleryShots: wantsGallery ? defaultGalleryShots(text) : [],
    }));
  }

  function classifyIntent(text, files) {
    const norm = normalizeUserIntentText(text);
    const t = norm.toLowerCase();
    const imgs = getEffectiveFiles(files, text);
    const hasImages = !!(imgs && imgs.length);
    const imageCount = hasImages ? imgs.length : 0;
    const wantsNewImage = wantsCreateOrGenerateImage(text);

    const wantsAdd =
      userWantsAddProduct(text, imgs) ||
      explicitWantsNewProduct(text) ||
      wantsMultipleDifferentProducts(text, imgs) ||
      wantsCreateMultipleProducts(text, imgs);

    const wantsImageWork = /(?:image|photo|picture|bild|foto|gallery|bilder|model)/.test(t) || wantsNewImage;

    const clearlyMultipleProducts = wantsMultipleDifferentProducts(text, imgs);

    const wantsAppendToOne =
      wantsImagesOnOneProduct(text, imgs) &&
      hasImages &&
      imageCount > 1 &&
      !wantsNewImage &&
      !/(?:generate|make|create|nano|banana|ai)\s+.*(?:other|more|extra|display|additional)\s*(?:images?|photos?)/.test(t) &&
      !/(?:other|more|extra|display|additional)\s+(?:images?|photos?)/.test(t);

    const wantsAddMultiple = wantsMultipleDifferentProducts(text, imgs);

    const wantsUpdateExisting =
      !wantsAddMultiple &&
      !wantsAdd &&
      userExplicitlyWantsMutateExisting(text);

    const wantsAiGenerate =
      wantsNewImage ||
      (/((?:generate|create|make|ai|nano|banana|gemini|model|mannequin|portrait|background|studio))/.test(t) &&
        (wantsImageWork ||
          /different|another|variation|variant|other images|display images|more images|wearing|black|white/.test(t) ||
          (hasImages && /\bthis\s+(?:model|image|photo)\b/.test(t))));

    const wantsGallery =
      /(?:gallery|more\s+images|fler\s+bilder|extra\s+images|display\s+images|andra\s+bilder|make other images|other images|product images)/.test(
        t
      ) &&
      (userExplicitlyWantsMutateExisting(text) || wantsImagesOnOneProduct(text, files));

    const wantsUseUpload =
      hasImages &&
      (wantsUpdateExisting || wantsAppendToOne) &&
      wantsImageWork &&
      !wantsAiGenerate &&
      /(?:use\s+this|set\s+this|upload|attach|with\s+this|put\s+this|this\s+image)/.test(t);

    return {
      wantsAdd,
      wantsAddMultiple,
      wantsAppendToOne,
      wantsUpdateExisting,
      wantsAiGenerate,
      wantsGallery,
      wantsImageWork,
      wantsUseUpload,
      hasImages,
      imageCount,
    };
  }

  function extractProductRef(text) {
    const m =
      String(text || '').match(/(?:product|produkt|produit)\s+["']([^"']+)["']/i) ||
      String(text || '').match(/(?:named?|called|namn|nom)\s+["']?([^"'\n.]+?)["']?(?:\s|$)/i);
    return m ? m[1].trim() : '';
  }

  function normalizeActions(actions, text, files) {
    const intent = classifyIntent(text, files);
    const flat = [];
    const preferAdd = shouldForceAddProducts(text, files);

    (actions || []).forEach((action) => {
      let a = { ...action };
      if (!a.type && a.match) a.type = preferAdd ? 'add_product' : 'update_product';
      if (!a.type) return;

      // Hard safety: when the user is adding, never accept update/replace/delete from the model
      if (
        preferAdd &&
        /^(update_product|replace_product_image|regenerate_product_image|generate_product_images|update_product_image|append_product_images|delete_product)$/.test(
          a.type
        )
      ) {
        if (a.type === 'delete_product') return;
        flat.push({
          type: 'add_product',
          name: a.name && !/^new product/i.test(String(a.name)) ? a.name : undefined,
          category: a.category,
          sub: a.sub,
          price: a.price,
          stock: a.stock,
          desc: a.desc || a.description,
          featured: a.featured,
          imageIndex: a.imageIndex != null ? a.imageIndex : a.referenceImageIndex != null ? a.referenceImageIndex : 0,
          imageIndices: a.imageIndices,
          generateGallery: false,
        });
        return;
      }

      if (a.type === 'add_product') {
        if (preferAdd) {
          flat.push(a);
          return;
        }
        const converted = convertAddToExistingActions(a, text, files, intent);
        if (converted) {
          converted.forEach((c) => flat.push(c));
          return;
        }
      }

      // Never delete unless clearly asked
      if (a.type === 'delete_product' && !/(?:delete|remove|ta bort|supprimer)/i.test(String(text || ''))) {
        return;
      }

      flat.push(a);
    });

    const rewritten = rewriteMisclassifiedActions(flat, text, files);
    const expanded = expandMultiImageActions(rewritten, text, files);
    return sanitizeActionsForAddMode(expanded, text, files);
  }

  function expandMultiImageActions(actions, text, files) {
    const intent = classifyIntent(text, files);
    const expanded = [];
    const multiAdd = wantsMultipleDifferentProducts(text, files);

    (actions || []).forEach((action) => {
      const indices =
        Array.isArray(action.imageIndices) && action.imageIndices.length
          ? action.imageIndices
          : action.imageIndex != null
            ? [action.imageIndex]
            : [];

      if (action.type === 'add_product' && multiAdd && files.length > 1) {
        if (indices.length > 1) {
          indices.forEach((idx, i) => {
            expanded.push({
              ...action,
              imageIndex: idx,
              imageIndices: undefined,
              name: action.name && !/^new product/i.test(action.name) ? action.name : undefined,
              generateGallery: false,
            });
          });
          return;
        }
        files.forEach((_, i) => {
          expanded.push({
            ...action,
            imageIndex: i,
            imageIndices: undefined,
            name:
              action.name && files.length === 1 && !/^new product/i.test(String(action.name))
                ? action.name
                : action.name && !/^new product/i.test(String(action.name))
                  ? action.name
                  : undefined,
            generateGallery: !!(action.generateGallery && files.length === 1),
            galleryShots: action.galleryShots,
          });
        });
        return;
      }

      if (
        action.type === 'add_product' &&
        files.length > 1 &&
        indices.length > 1 &&
        (intent.wantsAddMultiple || multiAdd) &&
        !wantsImagesOnOneProduct(text, files)
      ) {
        indices.forEach((idx, i) => {
          expanded.push({
            ...action,
            imageIndex: idx,
            imageIndices: undefined,
            name: action.name && indices.length === 1 ? action.name : action.name || 'New product ' + (i + 1),
            generateGallery: !!action.generateGallery && indices.length === 1,
          });
        });
        return;
      }

      if (
        action.type === 'append_product_images' &&
        files.length > 1 &&
        (!action.imageIndices || !action.imageIndices.length) &&
        action.imageIndex == null
      ) {
        expanded.push({
          ...action,
          imageIndices: files.map((_, i) => i),
          appendAllImages: true,
        });
        return;
      }

      expanded.push(action);
    });

    return expanded;
  }

  function resolveImageIndices(action, files) {
    if (action.appendAllImages && files && files.length) {
      return files.map((_, i) => i).filter((i) => files[i] && files[i].dataUrl);
    }
    if (Array.isArray(action.imageIndices) && action.imageIndices.length) {
      return action.imageIndices.filter((i) => files[i] && files[i].dataUrl);
    }
    if (
      (action.type === 'append_product_images' || action.appendImages) &&
      files &&
      files.length > 1 &&
      action.imageIndex == null
    ) {
      return files.map((_, i) => i).filter((i) => files[i] && files[i].dataUrl);
    }
    const idx = action.imageIndex != null ? action.imageIndex : 0;
    return files[idx] && files[idx].dataUrl ? [idx] : [];
  }

  function brandPrefix() {
    return 'MD3 Scandi luxury e-commerce product photo. Scandinavian minimal aesthetic, soft natural light, cream and neutral tones. ';
  }

  function normalizeGeminiImageSize(size) {
    const s = String(size || '1K').trim().toUpperCase();
    if (s === '512' || s === '1K' || s === '2K' || s === '4K') return s;
    return '1K';
  }

  function normalizeGeminiAspectRatio(ratio) {
    const r = String(ratio || '3:4').trim();
    const allowed = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
    return allowed.includes(r) ? r : '3:4';
  }

  function buildGeminiImageRequest(parts, aspectRatio, imageSize) {
    return {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
          imageSize: normalizeGeminiImageSize(imageSize),
        },
      },
    };
  }

  async function generateProductImage(prompt, referenceDataUrl, onProgress) {
    if (!hasAdminAiBackend()) throw new Error(cloudAISetupMessage());
    if (onProgress) onProgress();
    let reference = null;
    if (referenceDataUrl) {
      const asData = await ensureDataUrl(referenceDataUrl);
      if (!asData) {
        throw new Error(
          msg(
            'admin-ai-err-ref',
            'Could not load the product reference image. Open the product, or attach a photo with +, then try again.'
          )
        );
      }
      reference = await compressImage(asData, AI_REF_MAX_EDGE, 0.92);
    }
    const data = await postAdminAi('/adminAiImage', {
      prompt: String(prompt || '').slice(0, 2500),
      referenceDataUrl: reference || undefined,
    });
    if (!data || !data.dataUrl) throw new Error(msg('admin-ai-err-gen', 'Image generation failed. Try again in a moment.'));
    return compressImage(data.dataUrl, AI_STORE_MAX_EDGE, AI_STORE_JPEG_QUALITY);
  }

  async function buildGalleryImages(referenceDataUrl, shots, onProgress) {
    const prompts = (shots || []).slice(0, MAX_GALLERY_SHOTS);
    if (!prompts.length) return [];
    if (onProgress) onProgress(0, prompts.length);
    // Run gallery shots in parallel for speed (cap already small).
    const results = await Promise.all(
      prompts.map(async (prompt, i) => {
        try {
          const img = await generateProductImage(prompt, referenceDataUrl, null);
          if (onProgress) onProgress(i + 1, prompts.length);
          return img || null;
        } catch (e) {
          console.warn('gallery shot failed', i, e);
          if (onProgress) onProgress(i + 1, prompts.length);
          return e;
        }
      })
    );
    const out = results.filter((r) => typeof r === 'string' && r);
    const lastErr = results.find((r) => r && typeof r === 'object' && r.message);
    if (!out.length) {
      throw lastErr || new Error(msg('admin-ai-err-gen', 'Image generation failed. Try again in a moment.'));
    }
    return out;
  }

  function trackProduct(name) {
    if (!name) return;
    sessionCtx.lastProductNames.push(name);
    if (sessionCtx.lastProductNames.length > 20) {
      sessionCtx.lastProductNames = sessionCtx.lastProductNames.slice(-20);
    }
  }

  function captureSnapshot() {
    try {
      return {
        products: JSON.parse(JSON.stringify(S().getProducts())),
        siteAssets: JSON.parse(JSON.stringify(global.MD3SiteAssets ? global.MD3SiteAssets.load() : {})),
        langOverrides: JSON.parse(
          JSON.stringify(global.MD3Lang && global.MD3Lang.getOverrides ? global.MD3Lang.getOverrides() : {})
        ),
      };
    } catch (e) {
      console.warn('admin ai snapshot', e);
      return {
        products: (S().getProducts() || []).map((p) => ({ ...p, images: (p.images || []).slice(), image: p.image })),
        siteAssets: global.MD3SiteAssets ? global.MD3SiteAssets.load() : {},
        langOverrides: global.MD3Lang && global.MD3Lang.getOverrides ? global.MD3Lang.getOverrides() : {},
      };
    }
  }

  function slimSnapshotForStorage(snap) {
    if (!snap) return snap;
    return {
      products: stripHeavyImagesFromProducts(snap.products || []),
      siteAssets: snap.siteAssets || {},
      langOverrides: snap.langOverrides || {},
    };
  }

  function snapshotChangedIds(before, after) {
    const a = new Map(((before && before.products) || []).map((p) => [String(p.id), p]));
    const b = new Map(((after && after.products) || []).map((p) => [String(p.id), p]));
    const ids = new Set([...a.keys(), ...b.keys()]);
    const changed = [];
    ids.forEach((id) => {
      try {
        if (JSON.stringify(a.get(id) || null) !== JSON.stringify(b.get(id) || null)) changed.push(id);
      } catch (_) {
        changed.push(id);
      }
    });
    return changed;
  }

  function productHasDataImages(p) {
    const imgs = [
      ...(Array.isArray(p && p.images) ? p.images : []),
      p && p.image,
    ].filter((u) => typeof u === 'string' && u.trim());
    return imgs.some((u) => u.startsWith('data:'));
  }

  async function applySnapshot(snap) {
    if (!snap) return;
    const products = snap.products || [];
    const current = captureSnapshot();
    const changedIds = snapshotChangedIds(current, snap);
    const idsToSave = (changedIds.length ? changedIds : products.map((p) => p && p.id)).filter(
      (id) => id != null
    );
    const changedProducts = products.filter((p) => idsToSave.some((id) => String(id) === String(p.id)));
    const needsImageUpload = changedProducts.some(productHasDataImages);

    if (global.MD3Firebase && global.MD3Firebase.muteProductWatch) {
      global.MD3Firebase.muteProductWatch(30000);
    }
    if (S().guardProductRestore) {
      S().guardProductRestore(idsToSave, 30000);
    }

    // https URLs → metadata merge; data: blobs → full upload so undo actually sticks in cloud
    await S().saveProducts(products, {
      onlyIds: idsToSave,
      skipImages: !needsImageUpload,
      muteMs: 30000,
    });

    if (global.MD3Firebase && global.MD3Firebase.muteProductWatch) {
      global.MD3Firebase.muteProductWatch(30000);
    }

    if (global.MD3SiteAssets) {
      global.MD3SiteAssets.save(snap.siteAssets || {});
      global.MD3SiteAssets.applyToDocument();
    }
    if (global.MD3Lang && global.MD3Lang.restoreOverrides) {
      global.MD3Lang.restoreOverrides(snap.langOverrides || {});
    }
    if (S().syncHomeFeaturedFlags) S().syncHomeFeaturedFlags();
    if (typeof adminTab === 'function' && typeof adminTabActive !== 'undefined') {
      adminTab(adminTabActive);
    } else if (typeof paintAdminProductsList === 'function') {
      paintAdminProductsList();
    } else if (typeof renderAdminProducts === 'function') {
      renderAdminProducts();
    }
    try {
      window.dispatchEvent(new CustomEvent('md3-products-updated'));
    } catch (_) {}
  }

  function snapshotsEqual(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
      return false;
    }
  }

  function undoButtonHtml(turnId) {
    return (
      '<div class="admin-ai-turn-actions">' +
      '<button type="button" class="admin-ai-undo" data-turn="' +
      esc(turnId) +
      '">' +
      esc(msg('admin-ai-undo', 'Undo')) +
      '</button></div>'
    );
  }

  async function undoTurn(turnId) {
    const entry = turnSnapshots.find((t) => t.id === turnId);
    if (!entry || busy) return;
    if (!entry.before) {
      console.warn('admin ai undo missing before snapshot', turnId);
      return;
    }
    busy = true;
    try {
      redoStack.push({ turnId, snapshot: captureSnapshot() });
      await applySnapshot(entry.before);
      const btn = document.querySelector('.admin-ai-undo[data-turn="' + turnId + '"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = msg('admin-ai-undone', 'Undone');
        const row = btn.closest('.admin-ai-turn-actions');
        if (row && !row.querySelector('.admin-ai-redo')) {
          row.insertAdjacentHTML(
            'beforeend',
            '<button type="button" class="admin-ai-redo" data-turn="' +
              esc(turnId) +
              '">' +
              esc(msg('admin-ai-redo', 'Redo')) +
              '</button>'
          );
        }
      }
      persistChatSession();
    } catch (e) {
      console.error('admin ai undo', e);
      addBubble(
        'assistant',
        esc(msg('admin-ai-err-undo', 'Undo failed: ')) + esc((e && e.message) || String(e))
      );
    } finally {
      busy = false;
    }
  }

  async function redoTurn(turnId) {
    const entry = turnSnapshots.find((t) => t.id === turnId);
    if (!entry || busy) return;
    const redoEntry = redoStack.find((r) => r.turnId === turnId);
    const snap = (redoEntry && redoEntry.snapshot) || entry.after;
    if (!snap) return;
    busy = true;
    try {
      await applySnapshot(snap);
      redoStack = redoStack.filter((r) => r.turnId !== turnId);
      const redoBtn = document.querySelector('.admin-ai-redo[data-turn="' + turnId + '"]');
      const undoBtn = document.querySelector('.admin-ai-undo[data-turn="' + turnId + '"]');
      if (redoBtn) redoBtn.remove();
      if (undoBtn) {
        undoBtn.disabled = false;
        undoBtn.textContent = msg('admin-ai-undo', 'Undo');
      }
      persistChatSession();
    } catch (e) {
      console.error('admin ai redo', e);
      addBubble(
        'assistant',
        esc(msg('admin-ai-err-redo', 'Redo failed: ')) + esc((e && e.message) || String(e))
      );
    } finally {
      busy = false;
    }
  }

  function resolveSiteSlot(action) {
    const raw = action.slot || action.section || action.target || action.name || '';
    if (global.MD3SiteAssets && global.MD3SiteAssets.resolveSlot) {
      return global.MD3SiteAssets.resolveSlot(raw);
    }
    const q = String(raw).toLowerCase();
    if (/hero|header|start/.test(q)) return 'hero';
    if (/fashion|mode/.test(q)) return 'fashion';
    if (/maison|home/.test(q)) return 'maison';
    if (/lifestyle/.test(q)) return 'lifestyle';
    if (/limited|edition|édition/.test(q)) return 'limited';
    if (/manifesto/.test(q)) return 'manifesto';
    return null;
  }

  function isDestructiveAction(action) {
    const t = action && action.type;
    return (
      t === 'delete_product' ||
      t === 'remove_product' ||
      t === 'seed_defaults' ||
      t === 'set_featured' ||
      t === 'set_site_image' ||
      t === 'set_hero_image' ||
      t === 'set_fashion_image' ||
      t === 'set_site_text' ||
      t === 'update_site_text'
    );
  }

  function summarizeActions(actions) {
    return (actions || [])
      .map((a) => {
        const t = a.type || '?';
        const name = a.name || a.match || a.key || a.slot || '';
        return t + (name ? ' (' + name + ')' : '');
      })
      .join(', ');
  }

  function confirmAdminAi(title, text) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(!!ok);
      };
      if (typeof global.openConfirm === 'function') {
        const overlay = document.getElementById('confirmModal');
        const cancel = document.getElementById('confirmCancelBtn');
        const onDismiss = () => finish(false);
        global.openConfirm(title, text, '⚠️', () => finish(true));
        if (cancel) cancel.addEventListener('click', onDismiss, { once: true });
        if (overlay) {
          const onOverlay = (e) => {
            if (e.target === overlay) onDismiss();
          };
          overlay.addEventListener('click', onOverlay, { once: true });
        }
        return;
      }
      finish(window.confirm(title + '\n\n' + text));
    });
  }

  async function cleanupDeletedProductRefs(id) {
    try {
      if (!S().getUsers || !S().saveUsers) return;
      const users = S().getUsers();
      let changed = false;
      Object.values(users || {}).forEach((u) => {
        if (u.liked) {
          const next = u.liked.filter((i) => i !== id);
          if (next.length !== u.liked.length) {
            u.liked = next;
            changed = true;
          }
        }
        if (u.wishlist) {
          const next = u.wishlist.filter((i) => i !== id);
          if (next.length !== u.wishlist.length) {
            u.wishlist = next;
            changed = true;
          }
        }
      });
      if (changed) await S().saveUsers(users);
    } catch (e) {
      console.warn('cleanupDeletedProductRefs', e);
    }
  }

  function sanitizeSiteTextValue(value) {
    // Allow a small safe subset; strip scripts/events
    return String(value == null ? '' : value)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript:/gi, '');
  }

  function stripHeavyImagesFromProducts(products) {
    return (products || []).map((p) => {
      const copy = { ...p };
      const imgs = Array.isArray(copy.images) ? copy.images : copy.image ? [copy.image] : [];
      const light = imgs
        .filter((u) => typeof u === 'string' && u && !u.startsWith('data:'))
        .slice(0, 8);
      if (light.length) {
        copy.images = light;
        copy.image = light[0];
      } else {
        // Keep a marker so undo knows images existed but data URLs were too large to persist
        delete copy.images;
        delete copy.image;
      }
      return copy;
    });
  }

  async function executeAction(action, files, onProgress) {
    let type = action.type;
    const imgIdx = action.imageIndex != null ? action.imageIndex : 0;
    const img = files[imgIdx] && files[imgIdx].dataUrl;

    if (type === 'set_site_image' || type === 'set_hero_image' || type === 'set_fashion_image') {
      if (!img) return msg('admin-ai-need-image', 'Attach an image with + first.');
      const okSite = await confirmAdminAi(
        msg('admin-ai-confirm-site-title', 'Update site image?'),
        msg('admin-ai-confirm-site', 'This replaces a homepage / site image.')
      );
      if (!okSite) return msg('admin-ai-cancelled', 'Cancelled.');
      let slot = type === 'set_hero_image' ? 'hero' : type === 'set_fashion_image' ? 'fashion' : resolveSiteSlot(action);
      if (!slot) slot = resolveSiteSlot({ slot: sessionCtx.lastUserText || '' });
      if (!slot) return msg('admin-ai-err-slot', 'Which section? Try: hero, fashion, maison, lifestyle, limited, manifesto.');
      const url = await compressImage(img, slot === 'hero' ? 2400 : AI_STORE_MAX_EDGE, AI_STORE_JPEG_QUALITY);
      if (global.MD3SiteAssets && global.MD3SiteAssets.setImage) {
        global.MD3SiteAssets.setImage(slot, url);
      } else if (slot === 'hero') {
        global.MD3SiteAssets.setHero(url);
      } else {
        global.MD3SiteAssets.setFashion(url);
      }
      const label = (global.MD3SiteAssets.IMAGE_SLOTS && global.MD3SiteAssets.IMAGE_SLOTS[slot] && global.MD3SiteAssets.IMAGE_SLOTS[slot].label) || slot;
      return msg('admin-ai-done-site-image', 'Site image updated: ') + esc(label);
    }

    if (type === 'set_site_text' || type === 'update_site_text') {
      const key = action.key || action.i18n || action.textKey;
      const value = action.value != null ? action.value : action.text;
      if (!key || value == null) return msg('admin-ai-err-text', 'Text key and value required.');
      const okText = await confirmAdminAi(
        msg('admin-ai-confirm-text-title', 'Update site text?'),
        msg('admin-ai-confirm-text', 'Change ') + key + ' → ' + String(value).slice(0, 120)
      );
      if (!okText) return msg('admin-ai-cancelled', 'Cancelled.');
      const langs =
        !action.lang || action.lang === 'all'
          ? ['fr', 'en', 'ar']
          : ['fr', 'en', 'ar'].includes(String(action.lang))
            ? [String(action.lang)]
            : [currentLangCode()];
      const all = global.MD3Lang.getOverrides();
      const safeValue = sanitizeSiteTextValue(value);
      langs.forEach((lang) => {
        if (!all[lang]) all[lang] = {};
        all[lang][key] = safeValue;
      });
      if (global.MD3Lang.restoreOverrides) global.MD3Lang.restoreOverrides(all);
      return msg('admin-ai-done-site-text', 'Site text updated: ') + esc(key);
    }

    if (type === 'delete_product' || type === 'remove_product') {
      if (shouldForceAddProducts(sessionCtx.lastUserText || '', files)) {
        return msg('admin-ai-err-no-delete', 'Add mode — will not delete existing products. Ask clearly to delete if needed.');
      }
      const target = findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();
      const ok = await confirmAdminAi(
        msg('admin-ai-confirm-delete-title', 'Delete product?'),
        msg('admin-ai-confirm-delete', 'Permanently delete ') + target.name + '?'
      );
      if (!ok) return msg('admin-ai-cancelled', 'Cancelled.');
      const products = S().getProducts().filter((p) => p.id !== target.id);
      await S().saveProducts(products, { deletedIds: [target.id], skipImages: true });
      await cleanupDeletedProductRefs(target.id);
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-delete', 'Product removed: ') + esc(target.name);
    }

    if (type === 'seed_defaults') {
      const ok = await confirmAdminAi(
        msg('admin-ai-confirm-seed-title', 'Restore default catalogue?'),
        msg(
          'admin-ai-confirm-seed',
          'This replaces the catalogue with default products and can remove custom items. Continue?'
        )
      );
      if (!ok) return msg('admin-ai-cancelled', 'Cancelled.');
      const defaults = S().defaultProducts();
      const current = S().getProducts();
      const defaultIds = new Set(defaults.map((p) => String(p.id)));
      const orphanIds = current.filter((p) => !defaultIds.has(String(p.id))).map((p) => p.id);
      // Write defaults by id only, then delete orphans — never a blind full-sync wipe
      await S().saveProducts(defaults, { onlyIds: defaults.map((p) => p.id), skipImages: true });
      if (orphanIds.length) {
        const kept = S().getProducts().filter((p) => defaultIds.has(String(p.id)));
        await S().saveProducts(kept, { deletedIds: orphanIds, skipImages: true });
      }
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-seed', 'All default products restored and featured items set.');
    }

    if (type === 'generate_product_images' || type === 'append_product_images') {
      if (shouldForceAddProducts(sessionCtx.lastUserText || '', files)) {
        return executeAction(actionToAddProduct(action), files, onProgress);
      }
      const target = findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();

      const hasGalleryShots = !!(action.galleryShots || action.shots || action.prompts);
      const attachIdxs = resolveImageIndices(action, files).map((i) => files[i].dataUrl).filter(Boolean);
      const uploadOnlyAppend = type === 'append_product_images' && attachIdxs.length && !hasGalleryShots;

      if (!uploadOnlyAppend && !hasCloudAI()) return cloudAISetupMessage();

      const products = S().getProducts();
      const idx = products.findIndex((p) => p.id === target.id);
      const existing = S().normalizeProductImages(products[idx]);

      if (uploadOnlyAppend) {
        const nextImages = existing.concat(attachIdxs.filter((url) => !existing.includes(url)));
        products[idx] = S().normalizeProductFields({
          ...products[idx],
          images: nextImages,
          image: nextImages[0],
        });
        await S().saveProducts(products, { onlyIds: [target.id] });
        trackProduct(target.name);
        return (
          esc(msg('admin-ai-done-photos', 'Photos ready')) + ' — ' + esc(target.name) +
          ' (' +
          nextImages.length +
          ' ' +
          msg('admin-ai-images', 'images') +
          ')'
        );
      }

      const refIdx = action.referenceImageIndex != null ? action.referenceImageIndex : 0;
      const reference =
        (files[refIdx] && files[refIdx].dataUrl) ||
        attachIdxs[0] ||
        existing[0] ||
        target.image;
      if (!reference) return msg('admin-ai-need-image', 'Attach a reference image or add a product photo first.');

      const shots = (
        wantsModelWear(sessionCtx.lastUserText || '')
          ? modelWearGalleryShots(sessionCtx.lastUserText || '')
          : action.galleryShots ||
            action.shots ||
            action.prompts ||
            defaultGalleryShots(sessionCtx.lastUserText || '')
      ).slice(0, MAX_GALLERY_SHOTS);

      if (onProgress) {
        setLastBubble(photoProgressHtml(0, shots.length || 1));
      }

      const generated = await buildGalleryImages(reference, shots, (n, total) => {
        if (onProgress) setLastBubble(photoProgressHtml(n, total));
      });

      const replaceGallery = action.replaceGallery || action.replaceImages;
      let nextImages;
      if (type === 'append_product_images') {
        nextImages = existing.concat(attachIdxs).concat(generated);
      } else if (replaceGallery) {
        nextImages = attachIdxs.length ? attachIdxs.concat(generated) : [reference].concat(generated);
      } else {
        // Keep existing gallery; append AI shots after the reference/main image
        const head = existing.length ? existing.slice() : reference ? [reference] : [];
        if (reference && head[0] !== reference) {
          head[0] = reference;
        }
        generated.forEach((g) => {
          if (g && !head.includes(g)) head.push(g);
        });
        nextImages = head;
      }

      products[idx] = S().normalizeProductFields({
        ...products[idx],
        images: nextImages,
        image: nextImages[0],
      });
      await S().saveProducts(products, { onlyIds: [target.id] });
      trackProduct(target.name);
      return (
        esc(msg('admin-ai-done-photos', 'Photos ready')) +
        ' — ' +
        esc(target.name) +
        ' (' +
        generated.length +
        '/' +
        Math.max(generated.length, shots.length) +
        ')'
      );
    }

    if (type === 'replace_product_image' || type === 'regenerate_product_image') {
      if (shouldForceAddProducts(sessionCtx.lastUserText || '', files)) {
        return executeAction(actionToAddProduct(action), files, onProgress);
      }
      const target = findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();

      if (!hasCloudAI()) return cloudAISetupMessage();

      const refIdx = action.referenceImageIndex != null ? action.referenceImageIndex : 0;
      const uploadedRef = files[refIdx] && files[refIdx].dataUrl;
      const products = S().getProducts();
      const idx = products.findIndex((p) => p.id === target.id);
      const existing = S().normalizeProductImages(products[idx]);
      const catalogSlot =
        action.catalogImageIndex != null
          ? action.catalogImageIndex
          : sessionCtx.resolvedImageIndex != null
            ? sessionCtx.resolvedImageIndex
            : 0;
      const catalogRef = existing[catalogSlot] || existing[0] || target.image;
      const reference = action.useUploadedReference !== false ? uploadedRef || catalogRef : catalogRef || uploadedRef;
      if (!reference) return msg('admin-ai-need-image', 'Attach an image with + first.');

      const prompt = wantsModelWear(sessionCtx.lastUserText || '')
        ? modelWearPrompt(sessionCtx.lastUserText || '')
        : action.prompt ||
          action.description ||
          buildImageEditPrompt(sessionCtx.lastUserText || '') ||
          'Same product as the reference, fresh professional e-commerce catalog photo with different angle, lighting, and Scandinavian minimal styling';

      if (onProgress) {
        setLastBubble(photoProgressHtml(0, 1));
      }

      const newImg = await generateProductImage(prompt, reference, () => {
        if (onProgress) setLastBubble(photoProgressHtml(1, 1));
      });

      const nextImages = existing.length ? existing.slice() : [];
      while (nextImages.length <= catalogSlot) nextImages.push(newImg);
      nextImages[catalogSlot] = newImg;

      products[idx] = S().normalizeProductFields({
        ...products[idx],
        images: nextImages,
        image: catalogSlot === 0 ? newImg : nextImages[0] || newImg,
      });
      await S().saveProducts(products, { onlyIds: [target.id] });
      trackProduct(target.name);
      return (
        esc(msg('admin-ai-done-photo', 'Photo ready')) +
        ' — ' +
        esc(target.name) +
        (existing.length > 1 ? ' (' + (catalogSlot + 1) + '/' + nextImages.length + ')' : '')
      );
    }

    if (type === 'add_product' || type === 'update_product') {
      const text = sessionCtx.lastUserText || '';
      // Absolute safety: attached photos / add intent never update an existing row
      if (type === 'update_product' && shouldForceAddProducts(text, files)) {
        return executeAction(actionToAddProduct(action), files, onProgress);
      }
      if (type === 'add_product' || shouldForceAddProducts(text, files)) {
        type = 'add_product';
      }
      const products = S().getProducts();
      let target =
        type === 'update_product'
          ? findProductFromContext(action.match || action.name || 'focused', text)
          : null;
      const category = S().canonicalCategory(action.category || 'Mode');
      const sub = action.sub || 'Vêtements';
      const hasPrice = action.price != null && action.price !== '' && Number.isFinite(Number(action.price));
      const price = hasPrice ? Number(action.price) : 0;
      const stock = Math.max(0, parseInt(action.stock, 10) || 5);
      const desc = action.desc || action.description || '';
      let name = action.name || (target && target.name);
      if (!name && type === 'add_product') {
        if (wantsMultipleDifferentProducts(sessionCtx.lastUserText || '', files)) {
          const idx = (resolveImageIndices(action, files)[0] || 0) + 1;
          name = 'Product ' + idx;
        } else {
          name = extractNewProductName(sessionCtx.lastUserText || '', 0, 1) || 'New product';
        }
      }
      if (type === 'add_product' && isGenericProductName(name) && action.name && !isGenericProductName(action.name)) {
        name = action.name;
      }
      if (!name) return msg('admin-ai-err-name', 'Product name missing.');

      const indices = resolveImageIndices(action, files);
      let productImages = indices.map((i) => files[i].dataUrl);

      const wantsGallery =
        action.generateGallery ||
        (action.galleryShots && action.galleryShots.length) ||
        (action.shots && action.shots.length);
      const galleryShots = action.galleryShots || action.shots || [];

      if (wantsGallery && productImages.length) {
        const shotTotal = Math.max(1, (galleryShots && galleryShots.length) || MAX_GALLERY_SHOTS);
        if (onProgress) setLastBubble(photoProgressHtml(0, shotTotal));
        const extra = await buildGalleryImages(productImages[0], galleryShots, (n, total) => {
          if (onProgress) setLastBubble(photoProgressHtml(n, total));
        });
        productImages = [productImages[0]].concat(extra);
      }

      if (type === 'add_product') {
        const id = nextProductId(products);
        // Guard: never write over an id that already exists locally
        if (products.some((p) => Number(p.id) === Number(id))) {
          throw new Error('Product id collision — retry add');
        }
        const item = {
          id,
          name,
          category,
          sub,
          price,
          stock,
          desc,
          featured: !!action.featured,
          emoji: action.emoji || '✦',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        if (productImages.length) {
          item.images = productImages;
          item.image = productImages[0];
        }
        products.push(S().normalizeProductFields(item));
        await S().saveProducts(products, { onlyIds: [id] });
        S().syncHomeFeaturedFlags();
        setFocusedProduct(id, name);
        sessionCtx.resolvedProductId = null;
        const imgNote = productImages.length > 1 ? ' (' + productImages.length + ' images)' : '';
        return msg('admin-ai-done-add', 'Product added: ') + esc(name) + imgNote;
      }

      if (shouldForceAddProducts(sessionCtx.lastUserText || '', files)) {
        return executeAction(actionToAddProduct(action), files, onProgress);
      }

      if (!target) target = findProductFromContext(name, sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();

      const idx = products.findIndex((p) => p.id === target.id);
      const next = {
        ...products[idx],
        name: action.name || products[idx].name,
        category: action.category ? category : products[idx].category,
        sub: action.sub || products[idx].sub,
        price: action.price != null ? price : products[idx].price,
        stock: action.stock != null ? stock : products[idx].stock,
        desc: action.desc != null ? desc : products[idx].desc,
        featured: action.featured != null ? !!action.featured : products[idx].featured,
      };
      if (productImages.length) {
        const existingImages = S().normalizeProductImages(products[idx]);
        const shouldAppend =
          action.appendImages ||
          (type === 'update_product' && (productImages.length > 1 || action.appendImages === true));
        if (shouldAppend) {
          const merged = existingImages.slice();
          productImages.forEach((url) => {
            if (url && !merged.includes(url)) merged.push(url);
          });
          next.images = merged;
          next.image = merged[0];
        } else {
          next.images = productImages;
          next.image = productImages[0];
        }
      }
      products[idx] = S().normalizeProductFields(next);
      await S().saveProducts(products, { onlyIds: [target.id] });
      S().syncHomeFeaturedFlags();
      trackProduct(next.name);
      return msg('admin-ai-done-update', 'Product updated: ') + esc(next.name);
    }

    if (type === 'update_product_image') {
      if (shouldForceAddProducts(sessionCtx.lastUserText || '', files)) {
        return executeAction(actionToAddProduct(action), files, onProgress);
      }
      const target = findProductFromContext(action.name || action.match || 'focused', sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();
      const indices = resolveImageIndices(action, files);
      if (!indices.length) return msg('admin-ai-need-image', 'Attach an image with + first.');
      const newImgs = indices.map((i) => files[i].dataUrl).filter(Boolean);
      const products = S().getProducts();
      const idx = products.findIndex((p) => p.id === target.id);
      const existing = S().normalizeProductImages(products[idx]);
      const shouldAppend = action.appendImages !== false && (newImgs.length > 1 || action.appendImages);
      const nextImages = shouldAppend
        ? existing.concat(newImgs.filter((url) => !existing.includes(url)))
        : newImgs;
      products[idx] = S().normalizeProductFields({
        ...products[idx],
        images: nextImages,
        image: nextImages[0],
      });
      await S().saveProducts(products, { onlyIds: [target.id] });
      trackProduct(target.name);
      const imgNote =
        nextImages.length > 1 ? ' (' + nextImages.length + ' ' + msg('admin-ai-images', 'images') + ')' : '';
      return msg('admin-ai-done-update', 'Product updated: ') + esc(target.name) + imgNote;
    }

    if (type === 'set_featured') {
      const ok = await confirmAdminAi(
        msg('admin-ai-confirm-featured-title', 'Update featured products?'),
        msg('admin-ai-confirm-featured', 'This changes which products appear as featured on the homepage.')
      );
      if (!ok) return msg('admin-ai-cancelled', 'Cancelled.');
      const ids = Array.isArray(action.ids) ? action.ids : S().HOME_FEATURED_IDS;
      const idSet = new Set(ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)));
      const prev = S().getProducts();
      const products = prev.map((p) => ({
        ...p,
        featured: idSet.has(Number(p.id)),
      }));
      const onlyIds = products
        .filter((p, i) => !!prev[i].featured !== !!p.featured)
        .map((p) => p.id);
      if (!onlyIds.length) return msg('admin-ai-done-featured', 'Featured products updated.');
      await S().saveProducts(products, { onlyIds: onlyIds, skipImages: true });
      return msg('admin-ai-done-featured', 'Featured products updated.');
    }

    return null;
  }

  function actionsNeedPreview(actions) {
    const list = (actions || []).filter((a) => a && a.type);
    if (!list.length) return false;
    // Adds always apply immediately (with or without photos)
    if (list.every((a) => a.type === 'add_product')) return false;
    if (list.every((a) => isDestructiveAction(a))) return false; // confirmed per-action
    if (list.length > 1) return true;
    const a = list[0];
    // Image / field updates: short apply summary
    return (
      a.type === 'update_product' ||
      a.type === 'replace_product_image' ||
      a.type === 'generate_product_images' ||
      a.type === 'append_product_images' ||
      a.type === 'update_product_image' ||
      a.type === 'regenerate_product_image'
    );
  }

  async function executeAll(actions, files, onProgress) {
    const before = captureSnapshot();
    const lines = [];
    const text = sessionCtx.lastUserText || '';
    const safeActions = sanitizeActionsForAddMode(actions, text, files);
    if (!safeActions.length) {
      return {
        html: msg(
          'admin-ai-no-action',
          'I could not find a matching action. Try attaching images and describing what to create or update.'
        ),
        before,
        after: before,
        changed: false,
      };
    }
    if (actionsNeedPreview(safeActions)) {
      const ok = await confirmAdminAi(
        msg('admin-ai-confirm-apply-title', 'Apply AI changes?'),
        msg('admin-ai-confirm-apply', 'About to run: ') + summarizeActions(safeActions)
      );
      if (!ok) {
        return {
          html: msg('admin-ai-cancelled', 'Cancelled.'),
          before,
          after: before,
          changed: false,
        };
      }
    }
    for (const action of safeActions) {
      try {
        throwIfCancelled();
        const line = await executeAction(action, files, onProgress);
        if (line) lines.push(line);
      } catch (e) {
        console.error('admin ai action', e);
        lines.push((e && e.message) || String(e));
        if (cancelRequested || /abort/i.test(String(e && e.message))) break;
      }
    }
    if (typeof renderAdminProducts === 'function') renderAdminProducts();
    if (typeof adminTab === 'function' && typeof adminTabActive !== 'undefined') adminTab(adminTabActive);
    const after = captureSnapshot();
    const html = lines.length
      ? formatActionSummary(lines)
      : msg(
          'admin-ai-no-action',
          'I could not find a matching action. Try attaching images and describing what to create or update.'
        );
    const changed = !snapshotsEqual(before, after);
    return { html, before, after, changed };
  }

  function parseLocalCommands(text, files) {
    const t = normalizeUserIntentText(text).toLowerCase();
    const actions = [];
    const imgs = getEffectiveFiles(files, text);
    const intent = classifyIntent(text, imgs);
    const productRef = extractProductRef(text) || 'focused';
    const siteSlot = inferSiteImageSlot(text);

    if (
      /lägg till alla|alla produkter|standardprodukter|seed|default products|restore products|återställ produkter|add all products/.test(
        t
      )
    ) {
      actions.push({ type: 'seed_defaults' });
      return actions;
    }

    if (/delete|remove|ta bort|supprimer|supprime/.test(t) && /product|produkt|produit/.test(t)) {
      actions.push({ type: 'delete_product', match: productRef });
      return actions;
    }

    const priceMatch = text.match(
      /(?:pris|price)\s+(?:för|for|på|on|of)?\s*["']?([^"'\n]+?)["']?\s*(?:till|to|=|→)?\s*(\d+(?:[.,]\d+)?)/i
    );
    if (priceMatch) {
      actions.push({ type: 'update_product', match: priceMatch[1].trim(), price: Number(String(priceMatch[2]).replace(',', '.')) });
    }

    const descMatch = text.match(
      /(?:beskrivning|description)\s+(?:för|for)\s+["']?([^"'\n:]+?)["']?\s*[:\-]\s*(.+)/i
    );
    if (descMatch) {
      actions.push({ type: 'update_product', match: descMatch[1].trim(), desc: descMatch[2].trim() });
    }

    if (/featured|en vedette|utvalda|homepage products/.test(t) && !imgs.length) {
      const idMatch = text.match(/\b(\d+(?:\s*,\s*\d+)*)\b/);
      if (idMatch) {
        actions.push({ type: 'set_featured', ids: idMatch[1].split(/\s*,\s*/).map((n) => parseInt(n, 10)) });
      }
    }

    const textChange = text.match(
      /(?:change|set|update|modifier|ändra|changer)\s+(?:the\s+)?(?:hero\s+)?(?:headline|title|text|slogan|manifesto)\s*(?:to|:)\s*["']?(.+?)["']?\s*$/i
    );
    if (textChange) {
      let key = 'hero-subtitle';
      if (/manifesto/i.test(t)) key = 'manifesto';
      if (/featured|collection title/i.test(t)) key = 'featured-title';
      actions.push({ type: 'set_site_text', key, value: textChange[1].trim(), lang: 'all' });
    }

    if (imgs.length && siteSlot) {
      actions.push({ type: 'set_site_image', slot: siteSlot, imageIndex: 0 });
      return actions;
    }

    if (wantsMultipleDifferentProducts(text, imgs)) {
      return buildAddProductActions(text, imgs);
    }

    if (wantsImagesOnOneProduct(text, imgs) && imgs.length) {
      const match = productRef;
      const compound = [];

      if (intent.wantsGallery || intent.wantsAiGenerate || /(?:make|generate|create|other|display|additional).*(?:images?|photos?)/.test(t)) {
        compound.push({
          type: 'generate_product_images',
          match,
          referenceImageIndex: 0,
          galleryShots: defaultGalleryShots(text),
        });
      } else if (intent.wantsUpdateExisting && imgs.length === 1 && /(?:change|replace|swap|different|another)/.test(t)) {
        compound.push({
          type: 'replace_product_image',
          match,
          prompt: text.trim() || 'Professional catalog variation of the same product',
          referenceImageIndex: 0,
        });
      } else if (imgs.length > 1) {
        compound.push({
          type: 'append_product_images',
          match,
          imageIndices: imgs.map((_, i) => i),
          appendAllImages: true,
        });
      } else if (imgs.length === 1) {
        compound.push({ type: 'update_product_image', match, imageIndex: 0 });
      }

      if (compound.length) return compound;
    }

    if (intent.wantsGallery || (intent.wantsAiGenerate && refersExistingProduct(text, imgs))) {
      return [
        {
          type: 'generate_product_images',
          match: productRef,
          referenceImageIndex: 0,
          galleryShots: defaultGalleryShots(text),
        },
      ];
    }

    if (intent.wantsAppendToOne && imgs.length > 1) {
      actions.push({
        type: 'append_product_images',
        match: productRef,
        imageIndices: imgs.map((_, i) => i),
      });
      return actions;
    }

    if ((intent.wantsUpdateExisting || refersAttachedImageEdit(text, imgs) || wantsCreateOrGenerateImage(text)) && (intent.wantsAiGenerate || wantsCreateOrGenerateImage(text)) && imgs.length) {
      actions.push(buildImageGenerateAction(text, imgs));
      return actions;
    }

    if (intent.wantsUpdateExisting && intent.wantsUseUpload && imgs.length) {
      actions.push({
        type: 'update_product_image',
        match: productRef,
        imageIndices: imgs.length > 1 ? imgs.map((_, i) => i) : undefined,
        imageIndex: imgs.length === 1 ? 0 : undefined,
        appendImages: imgs.length > 1,
      });
      return actions;
    }

    if (intent.wantsUpdateExisting && imgs.length > 1 && intent.wantsImageWork && !intent.wantsAiGenerate) {
      actions.push({
        type: 'append_product_images',
        match: productRef,
        imageIndices: imgs.map((_, i) => i),
      });
      return actions;
    }

    if (intent.wantsUpdateExisting && imgs.length === 1 && intent.wantsImageWork && !intent.wantsAiGenerate) {
      actions.push({
        type: 'update_product_image',
        match: productRef,
        imageIndex: 0,
      });
      return actions;
    }

    if (intent.wantsGallery && imgs.length) {
      actions.push({
        type: 'generate_product_images',
        match: productRef,
        referenceImageIndex: 0,
        galleryShots: [
          'Professional flat lay on cream linen background, full product visible',
          'Close-up fabric and detail shot',
          'Lifestyle Nordic interior scene with product',
        ],
      });
      return actions;
    }

    if (
      imgs.length &&
      /(?:gallery|display images|product images|bilder|images pour|fler bilder|more images|make other images|andra bilder)/.test(t)
    ) {
      if (explicitWantsNewProduct(text) && /product|produkt|produit/.test(t)) {
        return buildAddProductActions(text, imgs, { generateGallery: true });
      }
      actions.push({
        type: 'generate_product_images',
        match: productRef,
        referenceImageIndex: 0,
        galleryShots: [
          'Professional flat lay on cream linen background, full product visible',
          'Close-up fabric and detail shot',
          'Lifestyle Nordic interior scene with product',
        ],
      });
      return actions;
    }

    if (intent.wantsAddMultiple || intent.wantsAdd || explicitWantsNewProduct(text) || userWantsAddProduct(text, imgs)) {
      if (imgs.length || explicitWantsNewProduct(text) || userWantsAddProduct(text, imgs)) {
        return buildAddProductActions(text, imgs);
      }
    }

    const jsonBlock = text.match(/\[[\s\S]*?\]|\{[\s\S]*"products"[\s\S]*\}/);
    if (jsonBlock) {
      try {
        let parsed = JSON.parse(jsonBlock[0]);
        if (parsed.products) parsed = parsed.products;
        if (Array.isArray(parsed)) {
          parsed.forEach((p, i) =>
            actions.push({
              type: 'add_product',
              name: p.name,
              category: p.category,
              sub: p.sub,
              price: p.price,
              stock: p.stock,
              desc: p.desc || p.description,
              featured: p.featured,
              emoji: p.emoji,
              imageIndex: imgs.length ? Math.min(i, imgs.length - 1) : undefined,
              generateGallery: !!(p.galleryShots && p.galleryShots.length),
              galleryShots: p.galleryShots || [],
            })
          );
          return actions;
        }
      } catch (_) {}
    }

    if (!actions.length && imgs.length && userWantsAddProduct(text, imgs)) {
      return buildAddProductActions(text, imgs);
    }

    if (!actions.length && imgs.length && userExplicitlyWantsMutateExisting(text)) {
      if (imgs.length > 1) {
        actions.push({
          type: 'append_product_images',
          match: 'focused',
          imageIndices: imgs.map((_, i) => i),
        });
      } else if (wantsCreateOrGenerateImage(text) || intent.wantsAiGenerate) {
        actions.push(buildImageGenerateAction(text, imgs));
      } else {
        actions.push({ type: 'update_product_image', match: 'focused', imageIndex: 0 });
      }
      return actions;
    }

    if (!actions.length && getActiveProduct() && wantsFocusedProductImageEdit(text)) {
      const shortFollowUp = /^(?:the\s+)?(?:image|photo|picture|model|shot|clothes?|garment)\s*\.?$/i.test(t.trim());
      const promptText = shortFollowUp ? sessionCtx.lastUserText || text : text;
      return [buildImageGenerateAction(promptText, imgs)];
    }

    return rewriteMisclassifiedActions(actions, text, imgs);
  }

  function inferActionsWhenEmpty(text, files, parsed) {
    let actions = rewriteMisclassifiedActions(parseLocalCommands(text, files), text, files);
    if (actions.length) return actions;
    const imgs = getEffectiveFiles(files, text);
    if (imgs.length && wantsMultipleDifferentProducts(text, imgs)) {
      return buildAddProductActions(text, imgs);
    }
    if (wantsModelWear(text) && (getActiveProduct() || imgs.length)) {
      return [buildImageGenerateAction(text, imgs)];
    }
    if (userWantsAddProduct(text, imgs) || explicitWantsNewProduct(text)) {
      return buildAddProductActions(text, imgs);
    }
    if (imgs.length && userExplicitlyWantsMutateExisting(text) && (wantsCreateOrGenerateImage(text) || refersAttachedImageEdit(text, imgs))) {
      return [buildImageGenerateAction(text, imgs)];
    }
    if (userExplicitlyWantsMutateExisting(text) && getActiveProduct() && wantsFocusedProductImageEdit(text)) {
      const t = normalizeUserIntentText(text).toLowerCase().trim();
      const shortFollowUp = /^(?:the\s+)?(?:image|photo|picture|model|shot)\s*\.?$/.test(t);
      const promptText = shortFollowUp ? sessionCtx.lastUserText || text : text;
      return [buildImageGenerateAction(promptText, imgs)];
    }
    if (parsed && parsed.reply && Array.isArray(parsed.actions) && parsed.actions.length) {
      return [];
    }
    return actions;
  }

  function mapServerActions(actions) {
    return (actions || []).map((a) => {
      if (!a || !a.type) return a;
      const type = String(a.type);
      if (type === 'create_product') {
        return {
          type: 'add_product',
          name: a.name,
          category: a.category,
          sub: a.sub,
          price: a.price,
          stock: a.stock,
          desc: a.description || a.desc,
          featured: a.featured,
          imageIndex: Array.isArray(a.attachmentIndices) ? a.attachmentIndices[0] : a.attachmentIndex,
          imageIndices: a.attachmentIndices,
          generateGallery: !!(a.generateImagePrompts && a.generateImagePrompts.length),
          galleryShots: a.generateImagePrompts || a.galleryShots || [],
        };
      }
      if (type === 'update_product') {
        const changes = a.changes || {};
        return {
          type: 'update_product',
          match: a.target || a.match || a.name || 'focused',
          name: changes.name,
          category: changes.category,
          sub: changes.sub,
          price: changes.price,
          stock: changes.stock,
          desc: changes.description || changes.desc,
          featured: changes.featured,
        };
      }
      if (type === 'delete_product') {
        return { type: 'delete_product', match: a.target || a.match || a.name || 'focused' };
      }
      if (type === 'generate_product_images') {
        return {
          type: 'generate_product_images',
          match: a.target || a.match || 'focused',
          galleryShots: a.prompts || a.galleryShots || [],
          referenceImageIndex: a.referenceAttachmentIndex != null ? a.referenceAttachmentIndex : 0,
          replaceGallery: !!a.replaceMain,
        };
      }
      if (type === 'set_site_image') {
        return {
          type: 'set_site_image',
          slot: a.slot,
          imageIndex: a.attachmentIndex != null ? a.attachmentIndex : 0,
        };
      }
      return a;
    }).filter(Boolean);
  }

  async function postAdminAi(path, body) {
    const base = adminAiBaseUrl();
    if (!base) throw new Error(cloudAISetupMessage());
    throwIfCancelled();
    const headers = adminAiAuthHeaders();
    if (!headers.Authorization && !headers['x-md3-admin-secret']) {
      throw new Error(
        msg('admin-ai-err-need-admin', 'Sign in as admin first (m3dadmin.com / 1111), then try again.')
      );
    }
    let res;
    try {
      res = await fetch(base + path, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers,
        body: JSON.stringify(body || {}),
        signal: activeAbort && activeAbort.signal,
      });
    } catch (networkErr) {
      const m = String((networkErr && networkErr.message) || networkErr || 'Load failed');
      throw new Error(m);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'Admin AI HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function callGemini(text, files) {
    const active = getActiveProduct();
    const focusedProduct = active
      ? { id: active.id, name: active.name, category: active.category, sub: active.sub, price: active.price }
      : sessionCtx.focusedProductId != null
        ? { id: sessionCtx.focusedProductId, name: sessionCtx.focusedProductName }
        : null;
    const attachments = (files || []).slice(0, 4).map((f, i) => ({
      name: (f && f.name) || 'image-' + i,
      dataUrl: f && f.dataUrl,
    }));
    const data = await postAdminAi('/adminAiPrompt', {
      prompt: text || '(see attachments)',
      products: S().getProducts(),
      focusedProduct,
      attachments,
    });
    return {
      reply: data.reply || '',
      actions: mapServerActions(data.actions || []),
    };
  }

  async function callOpenAI(text, files) {
    const key = openaiKey();
    const model = getCfg().model || 'gpt-4o-mini';
    const system = buildSystemPrompt();

    const messages = [{ role: 'system', content: system }];
    chatHistory.forEach((turn) => {
      if (turn.role === 'user') {
        const content = [{ type: 'text', text: turn.text || '' }];
        (turn.includeImages === false ? [] : turn.files || []).forEach((f) => {
          content.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'low' } });
        });
        messages.push({ role: 'user', content });
      } else if (turn.role === 'model') {
        messages.push({ role: 'assistant', content: turn.text || turn.summary || '' });
      }
    });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err.slice(0, 200));
    }
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message.content;
    return parseAiJson(raw);
  }

  async function callCloudAI(text, files) {
    if (!hasAdminAiBackend()) throw new Error(cloudAISetupMessage());
    return callGemini(text, files);
  }

  function pushHistoryTurn(turn) {
    chatHistory.push(turn);
    trimHistory();
    persistChatSession();
  }

  function markOlderImageTurns() {
    chatHistory.forEach((turn, i) => {
      if (turn.role === 'user' && turn.files && turn.files.length) {
        turn.includeImages = i >= chatHistory.length - 4;
      }
    });
  }

  function finalizeAssistantReply(result) {
    let replyHtml = result.html;
    if (result.changed) {
      const turnId = 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      turnSnapshots.push({ id: turnId, before: result.before, after: result.after });
      redoStack = [];
      replyHtml += undoButtonHtml(turnId);
    }
    return replyHtml;
  }

  async function handleSend() {
    if (busy) return;
    const input = $('adminAiInput');
    const text = (input && input.value.trim()) || '';
    if (!text && !attachments.length) return;

    busy = true;
    const sendBtn = $('adminAiSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    beginAbortableWork();

    const files = attachments.slice();
    attachments = [];
    renderAttachments();

    addBubble(
      'user',
      esc(text) +
        (files.length
          ? `<div class="admin-ai-user-imgs">${files.map((a) => `<img src="${esc(a.dataUrl)}" alt="" />`).join('')}</div>`
          : '')
    );
    if (input) input.value = '';

    sessionCtx.lastFiles = files;
    sessionCtx.lastUserText = text;
    sessionCtx.resolvedProductId = null;
    sessionCtx.resolvedImageIndex = null;
    sessionCtx.resolvedMatchMethod = '';

    pushHistoryTurn({
      role: 'user',
      text: text || '(attached ' + files.length + ' image(s))',
      files: files,
      includeImages: true,
    });
    markOlderImageTurns();

    const workFiles = getEffectiveFiles(files, text);

    addBubble('assistant', '<span class="admin-ai-typing">' + msg('admin-ai-thinking', 'Working…') + '</span>');

    // Only identify an existing catalog product when the user clearly asked to change one.
    // Never run this on add/create flows — visual similarity was rewriting new products into replacements.
    if (workFiles.length && userExplicitlyWantsMutateExisting(text) && !userWantsAddProduct(text, workFiles)) {
      setLastBubble(
        '<span class="admin-ai-typing">' + esc(msg('admin-ai-identifying', 'Identifying product from photo…')) + '</span>'
      );
      try {
        const resolved = await resolveProductFromAttachments(workFiles, text);
        if (resolved && resolved.product) {
          sessionCtx.resolvedProductId = resolved.product.id;
          sessionCtx.resolvedImageIndex = resolved.imageIndex;
          sessionCtx.resolvedMatchMethod = resolved.method || '';
          setFocusedProduct(resolved.product.id, resolved.product.name);
        }
      } catch (e) {
        console.warn('admin ai image resolve', e);
      }
      setLastBubble('<span class="admin-ai-typing">' + msg('admin-ai-thinking', 'Working…') + '</span>');
    } else if (userWantsAddProduct(text, workFiles)) {
      sessionCtx.resolvedProductId = null;
      sessionCtx.resolvedImageIndex = null;
      sessionCtx.resolvedMatchMethod = '';
      sessionCtx.focusedProductId = null;
      sessionCtx.focusedProductName = '';
    }

    try {
      let replyHtml;
      let parsed = null;
      let actions = [];
      let usedCloud = false;
      let cloudErr = null;

      if (hasCloudAI()) {
        try {
          parsed = await callCloudAI(text, workFiles);
          actions = normalizeActions((parsed && parsed.actions) || [], text, workFiles);
          usedCloud = true;
          if (!actions.length) {
            actions = inferActionsWhenEmpty(text, workFiles, parsed);
          }
        } catch (e) {
          cloudErr = e;
          console.warn('admin ai cloud fallback', e);
          actions = inferActionsWhenEmpty(text, workFiles, null);
        }
      } else {
        actions = inferActionsWhenEmpty(text, workFiles, null);
      }

      // Hard guarantee: "make/add a new product" always becomes add_product
      if (shouldForceAddProducts(text, workFiles)) {
        const hasAdd = (actions || []).some((a) => a && a.type === 'add_product');
        if (!hasAdd) {
          actions = buildAddProductActions(text, workFiles, { generateGallery: wantsModelWear(text) });
        } else {
          actions = sanitizeActionsForAddMode(actions, text, workFiles);
        }
      } else if (wantsModelWear(text)) {
        // Follow-ups like "make a model wear it" must edit the existing product, never add
        const hasImageAction = (actions || []).some(
          (a) =>
            a &&
            /^(replace_product_image|regenerate_product_image|generate_product_images|update_product_image)$/.test(
              a.type
            )
        );
        if (!hasImageAction) {
          actions = [buildImageGenerateAction(text, workFiles)];
        }
      }

      if (!actions.length) {
        const intro = (() => {
          const c = cleanCloudReply(parsed && parsed.reply, { suppress: false });
          return c ? esc(c) + '<br>' : '';
        })();
        let hint = '';
        if (cloudErr) {
          hint =
            '<br><small class="admin-ai-hint admin-ai-hint--err">' +
            esc(formatCloudError(cloudErr)) +
            '</small>';
        } else if (!hasCloudAI() && getActiveProduct()) {
          hint =
            '<br><small class="admin-ai-hint admin-ai-hint--err">' +
            esc(cloudAISetupMessage()) +
            '</small>';
        }
        replyHtml =
          intro ||
          esc(
            msg(
              'admin-ai-clarify',
              'What should I do? Examples: "add these as separate products", "add all images to this product", update price, change hero image…'
            )
          );
        if (hint) replyHtml += hint;
        setLastBubble(replyHtml);
        persistChatSession();
        pushHistoryTurn({
          role: 'model',
          text: (parsed && parsed.reply) || replyHtml.replace(/<[^>]+>/g, ' ').slice(0, 500),
          summary: replyHtml.replace(/<[^>]+>/g, ' ').slice(0, 400),
        });
        markOlderImageTurns();
        endAbortableWork();
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        return;
      }

      const exec = await executeAll(actions, workFiles, true);
      // Never prepend Gemini chatter — status lines are enough
      replyHtml = finalizeAssistantReply({ ...exec, html: exec.html });

      if (!hasCloudAI() && !$('adminAiMessages').dataset.hinted) {
        replyHtml +=
          '<br><small class="admin-ai-hint">' +
          esc(
            msg(
              'admin-ai-hint-local',
              'Tip: set GEMINI_API_KEY in .env, then run node scripts/sync-ai-config.mjs'
            )
          ) +
          '</small>';
        $('adminAiMessages').dataset.hinted = '1';
      } else if ((hasCloudAI() || geminiKey()) && !usedCloud && cloudErr && !$('adminAiMessages').dataset.cloudErr) {
        replyHtml +=
          '<br><small class="admin-ai-hint admin-ai-hint--err">' +
          esc(formatCloudError(cloudErr)) +
          '</small>';
        $('adminAiMessages').dataset.cloudErr = '1';
      } else if (geminiKeyIssue() && !$('adminAiMessages').dataset.hinted) {
        replyHtml +=
          '<br><small class="admin-ai-hint admin-ai-hint--err">' +
          esc(cloudAISetupMessage()) +
          '</small>';
        $('adminAiMessages').dataset.hinted = '1';
      }

      setLastBubble(replyHtml);
      persistChatSession();

      pushHistoryTurn({
        role: 'model',
        text: parsed && parsed.reply ? parsed.reply : replyHtml.replace(/<[^>]+>/g, ' ').slice(0, 500),
        summary: replyHtml.replace(/<[^>]+>/g, ' ').slice(0, 400),
      });
      markOlderImageTurns();
    } catch (e) {
      console.error('admin ai', e);
      if (cancelRequested || (e && (e.name === 'AbortError' || /abort|cancel/i.test(String(e.message || e))))) {
        setLastBubble(esc(msg('admin-ai-cancelled', 'Cancelled.')));
        persistChatSession();
        endAbortableWork();
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        return;
      }
      const fallbackFiles = getEffectiveFiles(sessionCtx.lastFiles || [], text);
      const fallback = inferActionsWhenEmpty(text, fallbackFiles, null);
      if (fallback.length) {
        try {
          const exec = await executeAll(fallback, fallbackFiles, true);
          setLastBubble(finalizeAssistantReply(exec));
          persistChatSession();
          pushHistoryTurn({
            role: 'model',
            text: exec.html.replace(/<[^>]+>/g, ' ').slice(0, 500),
            summary: exec.html.replace(/<[^>]+>/g, ' ').slice(0, 400),
          });
          markOlderImageTurns();
        } catch (e2) {
          setLastBubble(esc(msg('admin-ai-err', 'Something went wrong: ')) + esc(e2.message || String(e2)));
        }
      } else {
        setLastBubble(esc(msg('admin-ai-err', 'Something went wrong: ')) + esc(e.message || String(e)));
      }
    }

    endAbortableWork();
    busy = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  function bind() {
    const plus = $('adminAiAttachBtn');
    const fileInput = $('adminAiFileInput');
    const sendBtn = $('adminAiSendBtn');
    const input = $('adminAiInput');
    const toggle = $('adminAiToggle');
    const panel = $('adminAi');

    if (plus && fileInput) {
      plus.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        addFiles(e.target.files);
        fileInput.value = '';
      });
    }

    if (sendBtn) sendBtn.addEventListener('click', handleSend);
    const cancelBtn = $('adminAiCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', requestCancelAi);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
      const autosize = () => {
        if (input.tagName !== 'TEXTAREA') return;
        input.style.height = 'auto';
        input.style.height = Math.min(140, input.scrollHeight) + 'px';
      };
      input.addEventListener('input', autosize);
    }

    if (toggle && panel) {
      toggle.addEventListener('click', () => {
        panel.classList.toggle('admin-ai--collapsed');
        toggle.textContent = panel.classList.contains('admin-ai--collapsed') ? '+' : '−';
      });
    }

    const drop = $('adminAi');
    if (drop) {
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('admin-ai--drag');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('admin-ai--drag'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('admin-ai--drag');
        addFiles(e.dataTransfer.files);
      });
    }

    const messages = $('adminAiMessages');
    if (messages) {
      messages.addEventListener('click', (e) => {
        const undoBtn = e.target.closest('.admin-ai-undo');
        const redoBtn = e.target.closest('.admin-ai-redo');
        if (undoBtn && undoBtn.dataset.turn) {
          e.preventDefault();
          undoTurn(undoBtn.dataset.turn);
        }
        if (redoBtn && redoBtn.dataset.turn) {
          e.preventDefault();
          redoTurn(redoBtn.dataset.turn);
        }
      });
    }
  }

  function showWelcomeBubble() {
    addBubble(
      'assistant',
      esc(
        msg(
          'admin-ai-welcome',
          'Hi! I can change anything on the site — hero, section images, headlines, products, and more. Attach images with + or describe what to change. Each reply has an Undo button.'
        )
      )
    );
  }

  function showKeyWarningIfNeeded() {
    const el = $('adminAiKeyWarn');
    if (!el) return;
    if (hasAdminAiBackend()) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = cloudAISetupMessage();
  }

  function init() {
    if (!$('adminAi') || $('adminAi').dataset.inited === '1') return;
    $('adminAi').dataset.inited = '1';
    clearExpiredChatSession();
    bind();
    updateFocusChip();
    showKeyWarningIfNeeded();
    if (!restoreChatSession()) {
      showWelcomeBubble();
    }
  }

  global.MD3AdminAI = {
    init,
    handleSend,
    parseLocalCommands,
    executeAll,
    setFocusedProduct,
    getFocusedProductId,
    setAdminListContext,
    updateFocusChip,
    classifyIntent,
    expandMultiImageActions,
    wantsCreateMultipleProducts,
    wantsMultipleDifferentProducts,
    wantsImagesOnOneProduct,
    buildAddProductActions,
  };
})(typeof window !== 'undefined' ? window : globalThis);
