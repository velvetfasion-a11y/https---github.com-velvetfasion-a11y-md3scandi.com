/**
 * MD3 Admin — AI assistant with chat memory, Gemini Pro, and product image generation
 */
(function (global) {
  const S = () => global.MD3Store;
  const L = (k) => (global.MD3Lang ? global.MD3Lang.t(k) : k);
  const MAX_ATTACH = 8;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
  const MAX_HISTORY_TURNS = 24;
  const MAX_GALLERY_SHOTS = 4;
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

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function currentLangCode() {
    return global.MD3Lang && global.MD3Lang.getLang ? global.MD3Lang.getLang() : 'fr';
  }

  function getCfg() {
    return global.MD3_AI_CONFIG || {};
  }

  function geminiKey() {
    const k = getCfg().geminiApiKey;
    return k && !String(k).includes('YOUR_') ? String(k).trim() : '';
  }

  function geminiModelUrl(model, method) {
    return (
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':' +
      (method || 'generateContent')
    );
  }

  function geminiFetchOptions(key, body) {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    };
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
    return !!geminiKey() && !geminiKeyIssue();
  }

  function openaiKey() {
    const k = getCfg().openaiApiKey;
    return k && !String(k).includes('YOUR_') ? k : '';
  }

  function hasOpenAI() {
    return !!openaiKey();
  }

  function hasCloudAI() {
    const p = (getCfg().provider || 'gemini').toLowerCase();
    if (p === 'openai') return hasOpenAI();
    if (p === 'gemini') return hasGemini() || (!!geminiKey() && !hasOpenAI());
    return hasGemini() || hasOpenAI();
  }

  function cloudAISetupMessage() {
    const issue = geminiKeyIssue();
    if (issue === 'oauth_not_api_key') {
      return msg(
        'admin-ai-err-bad-key-type',
        'Wrong key type in GEMINI_API_KEY. Use an API key from aistudio.google.com/apikey (AQ.… or AIza…), not a Google sign-in OAuth token (ya29.…). Update .env, run node scripts/sync-ai-config.mjs, and add the same key to GitHub Actions secrets for the live site.'
      );
    }
    if (issue === 'bad_format') {
      return msg(
        'admin-ai-err-bad-key-format',
        'GEMINI_API_KEY does not look valid. Create a key at aistudio.google.com/apikey (AQ.… or AIza…), put it in .env, then run node scripts/sync-ai-config.mjs.'
      );
    }
    return msg(
      'admin-ai-err-no-key',
      'Gemini API key missing. Locally: set GEMINI_API_KEY in .env, then run node scripts/sync-ai-config.mjs. Live site: add GEMINI_API_KEY in GitHub → Settings → Secrets → Actions.'
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
    const preferred = getCfg().geminiImageModel || 'gemini-3-pro-image';
    return [
      preferred,
      'gemini-3-pro-image',
      'gemini-3-pro-image-preview',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-2.5-flash-image',
    ].filter((m, i, a) => a.indexOf(m) === i);
  }

  function dataUrlToGeminiPart(dataUrl) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { inline_data: { mime_type: m[1], data: m[2] } };
  }

  function geminiPartToDataUrl(part) {
    const inline = part.inline_data || part.inlineData;
    if (!inline) return null;
    const mime = inline.mime_type || inline.mimeType || 'image/png';
    const data = inline.data;
    if (!data) return null;
    return 'data:' + mime + ';base64,' + data;
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
    const focused =
      sessionCtx.focusedProductId != null
        ? products.find((p) => p.id === sessionCtx.focusedProductId) || { id: sessionCtx.focusedProductId, name: sessionCtx.focusedProductName }
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
You remember the full conversation. Use prior messages to resolve "this product", "it", "them", follow-ups, and multi-step requests.

You can change ANYTHING on the site:
- Site images (attach photo + say which section): hero, fashion/mode card, maison card, lifestyle card, limited edition card, manifesto background
- Site text/copy via set_site_text (headlines, descriptions, manifesto, values, footer, etc.)
- Products: add, update, delete, images, gallery, prices, featured
- Restore default product catalogue (seed_defaults)

CRITICAL — read user intent before choosing actions:
- "change / replace / different image for this product" → UPDATE existing product (never add_product).
- User attaches a screenshot of an existing product card → identify product by visible name/price/id and UPDATE it.
- add_product ONLY when user clearly asks to ADD/CREATE a NEW product for the catalogue.
- "change hero / header / mode section / maison image" → set_site_image with the right slot (not a product action).
- "change headline / title / text / description on homepage" → set_site_text with the i18n key.

MULTIPLE ATTACHMENTS — choose ONE mode per message:

A) DIFFERENT PRODUCTS (one listing per photo):
   User attaches 2+ photos of DIFFERENT items → return ONE add_product per image (imageIndex 0,1,2…).
   Triggers: "different/separate products", "each photo is a product", "add these to shop", multiple items without "one product".
   Analyze EACH photo separately for name, category, price, description.

B) ONE PRODUCT, MANY IMAGES (gallery / same item):
   User attaches 2+ photos of the SAME item OR says "this product", "same product", "add all images to…" OR a product is focused in editor
   → ONE action only: append_product_images { match:"focused", imageIndices:[0,1,2,…] }
   OR generate_product_images / update_product_image / replace_product_image — NEVER multiple add_product.

C) If a product is OPEN in the editor and user attaches several photos WITHOUT saying "different/separate products" → mode B (one product).

D) If user says "different products" or "each is a separate product" while a product is focused → mode A overrides focus.

Example A — 3 photos of 3 items + "add these to the shop":
  [{"type":"add_product","imageIndex":0,"name":"...","desc":"..."},{"type":"add_product","imageIndex":1,...},{"type":"add_product","imageIndex":2,...}]

Example B — 4 photos of same dress + "add all images to this product":
  [{"type":"append_product_images","match":"focused","imageIndices":[0,1,2,3]}]

MULTIPLE ATTACHMENTS (legacy detail):
- User attaches several photos of DIFFERENT items and wants new catalogue entries → return ONE add_product per image, each with a unique imageIndex (0, 1, 2…). Analyze each photo separately for name, category, price, description.
- User attaches several photos of the SAME item, or says "add these images to this product" / gallery / all photos to one product → return ONE append_product_images { match:"focused"|product name, imageIndices:[0,1,2,…] } OR update_product with appendImages:true. Never split into multiple products.
- If a product is focused in the editor, multiple uploads default to that ONE product unless user clearly asks for multiple new products.
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
- NEVER return add_product when user says "this product", "for this product", "change image", "make/generate images", or a product is focused in the editor.

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
${focused ? 'Product currently open in editor (use match:"focused" for "this product"): ' + JSON.stringify(focused) + '.' : 'No product open in editor — use product name or "last" from chat.'}
When the user attaches a product/catalog photo, identify which catalog product and which gallery image index (0=main) it matches — even if they say "this model" or "this image" without naming the product. Use replace_product_image with catalogImageIndex for that slot.
User may write Swedish, French, English, or Arabic.
Always return actions when the user wants products created/updated — never reply with only text if work can be done.
NEVER default to add_product just because the user attached an image.
An image alone is NOT a request to add a product — infer intent from words + chat context + whether a product is focused.
If intent is unclear AND you cannot infer any action from chat + images, return {"reply":"short clarifying question","actions":[]} — do NOT guess add_product.
NEVER return empty actions when the user asks to create/generate/make a new image (with or without the word "product") and an image is attached or was attached in the previous message — use replace_product_image or generate_product_images with match:"focused" after identifying the product from the photo.
When user says "create a new image" / "generate image" / "make a new photo" → replace_product_image or generate_product_images on the product shown in the attached image.
Product screenshots / admin UI shots → update existing product, never add_product.`;
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
      turnSnapshots: noSnapshots ? [] : turnSnapshots.slice(-MAX_PERSISTED_SNAPSHOTS),
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
        el.className = 'admin-ai-msg admin-ai-msg--' + m.role;
        el.innerHTML = m.html;
        box.appendChild(el);
      });
      box.scrollTop = box.scrollHeight;

      data.expiresAt = Date.now() + HISTORY_TTL_MS;
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(data));
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
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await readFileAsDataUrl(blob);
      catalogImageDataUrlCache.set(key, dataUrl);
      return dataUrl;
    } catch (_) {
      return null;
    }
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

    return best.score >= 0.8 ? best : null;
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
        const res = await fetch(url, geminiFetchOptions(key, { contents: [{ parts }] }));
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
        if (!id) return null;
        return {
          productId: id,
          imageIndex: parsed.imageIndex != null ? parseInt(parsed.imageIndex, 10) : 0,
          confidence: Number(parsed.confidence) || 0.75,
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
    if (wantsMultipleDifferentProducts(text, imgs)) return false;
    if (wantsCreateOrGenerateImage(text)) return true;
    if (explicitWantsNewProduct(text) && !refersExistingProduct(text, imgs)) return false;
    if (inferSiteImageSlot(text)) return false;
    const t = normalizeUserIntentText(text).toLowerCase();
    return (
      /(?:change|replace|swap|update|edit|modify|make|create|generate|retouch|recolor|fix)\b/.test(t) ||
      /\bthis\s+(?:model|image|photo|picture|shot|one)\b/.test(t) ||
      /(?:model|background|studio|mannequin|portrait)/.test(t) ||
      !t
    );
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
      sessionCtx.resolvedProductId != null
        ? 'focused'
        : sessionCtx.focusedProductId != null
          ? 'focused'
          : 'last';
    const modelShot = /model|mannequin|portrait|wearing|background|studio/.test(normalizeUserIntentText(text).toLowerCase());
    return {
      type: 'replace_product_image',
      match: productRef,
      prompt:
        buildImageEditPrompt(text) ||
        (modelShot
          ? 'Professional fashion model wearing the same garment from the reference photo, full-body e-commerce catalog shot, Scandinavian minimal styling, soft natural light'
          : 'Fresh professional e-commerce catalog photo of the same product, new angle, lighting, and Scandinavian minimal styling'),
      referenceImageIndex: 0,
      catalogImageIndex: sessionCtx.resolvedImageIndex != null ? sessionCtx.resolvedImageIndex : 0,
      useUploadedReference: !!(imgs && imgs.length),
    };
  }

  async function compressImage(dataUrl, maxW) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const cap = maxW || 2400;
        if (w > cap) {
          h = Math.round((h * cap) / w);
          w = cap;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
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
      dataUrl = await compressImage(dataUrl, 3840);
      attachments.push({ name: file.name, dataUrl });
    }
    renderAttachments();
  }

  function nextProductId(products) {
    return products.length ? Math.max(...products.map((p) => p.id)) + 1 : 1;
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
    return (
      products.find((p) => p.name === raw) ||
      products.find((p) => p.name.toLowerCase() === q) ||
      products.find((p) => p.name.toLowerCase().includes(q)) ||
      products.find((p) => q.includes(p.name.toLowerCase()))
    );
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

    if (q === 'focused' || q === 'this' || q === 'current' || q === 'editor') {
      if (sessionCtx.focusedProductId != null) {
        const hit = products.find((p) => p.id === sessionCtx.focusedProductId);
        if (hit) return hit;
      }
      if (sessionCtx.focusedProductName) {
        const byName = findProductByName(sessionCtx.focusedProductName);
        if (byName) return byName;
      }
    }

    if (/this product|den här produkten|det här|ce produit|cette produit|le produit|denna produkt/i.test(text || '')) {
      if (sessionCtx.focusedProductId != null) {
        const hit = products.find((p) => p.id === sessionCtx.focusedProductId);
        if (hit) return hit;
      }
      const last = sessionCtx.lastProductNames[sessionCtx.lastProductNames.length - 1];
      if (last) {
        const byLast = findProductByName(last);
        if (byLast) return byLast;
      }
    }

    if (/\bthis\s+(?:model|image|photo|picture|shot)\b/i.test(text || '')) {
      if (sessionCtx.focusedProductId != null) {
        const hit = products.find((p) => p.id === sessionCtx.focusedProductId);
        if (hit) return hit;
      }
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

    if (/this product|different image|ce produit|den här|image of this product|the image of this/i.test(text || '')) {
      const visible = getVisibleProducts();
      if (visible.length === 1) return visible[0];
      const real = products.filter((p) => !/^New product(\s+\d+)?$/i.test(String(p.name || '').trim()));
      if (real.length === 1) return real[0];
    }

    const fromKeywords = findProductFromKeywords(text);
    if (fromKeywords) return fromKeywords;

    const visibleOnly = getVisibleProducts();
    if (visibleOnly.length === 1 && /(?:change|replace|update|image|photo|model|gallery)/i.test(text || '')) {
      return visibleOnly[0];
    }

    return null;
  }

  function getFocusedProductLabel() {
    if (sessionCtx.focusedProductId == null) return '';
    const p = S().getProducts().find((x) => x.id === sessionCtx.focusedProductId);
    const name = String((p && p.name) || sessionCtx.focusedProductName || '').trim();
    if (!name || name === '.' || name === '·') return p ? 'Product #' + p.id : '';
    return name;
  }

  function updateFocusChip() {
    const el = $('adminAiFocus');
    if (!el) return;
    const name = getFocusedProductLabel();
    if (sessionCtx.focusedProductId != null && name) {
      el.hidden = false;
      el.textContent =
        msg('admin-ai-focus-on', 'Focused: ') +
        name +
        ' — ' +
        msg('admin-ai-focus-hint', 'AI commands apply to this product');
    } else {
      el.hidden = false;
      el.textContent = msg(
        'admin-ai-focus-none',
        'No product selected — click a product card before saying "this product"'
      );
    }
  }

  function setAdminListContext(ctx) {
    sessionCtx.adminVisibleIds = Array.isArray(ctx && ctx.visibleIds) ? ctx.visibleIds.slice() : [];
    updateFocusChip();
  }

  function getFocusedProductId() {
    return sessionCtx.focusedProductId;
  }

  function setFocusedProduct(id, name) {
    sessionCtx.focusedProductId = id != null ? parseInt(id, 10) : null;
    sessionCtx.focusedProductName = name ? String(name) : '';
    if (name) trackProduct(name);
    updateFocusChip();
    persistChatSession();
    if (typeof global.renderAdminProducts === 'function') global.renderAdminProducts();
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

    if (sessionCtx.focusedProductId != null) {
      return true;
    }

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

    if (
      n > 1 &&
      sessionCtx.focusedProductId == null &&
      /^(?:add|upload|import|publish|lägg till|ajouter)?\s*(?:these|those|all|them|photos?|images?|bilder)?\s*[!.]*$/i.test(
        t.trim()
      )
    ) {
      return true;
    }

    return wantsCreateMultipleProducts(text, files);
  }

  function refersExistingProduct(text, files) {
    if (wantsCreateOrGenerateImage(text)) return true;
    const imgs = getEffectiveFiles(files, text);
    if (imgs.length && refersAttachedImageEdit(text, imgs)) return true;
    if (wantsMultipleDifferentProducts(text, files)) return false;
    if (wantsImagesOnOneProduct(text, files)) return true;

    const t = String(text || '').toLowerCase();
    if (
      /\bthis\s+product\b/.test(t) ||
      /(?:for|on|to|of)\s+(?:this|the|that)\s+product/.test(t) ||
      /(?:den\s+här|denna|det\s+här|ce\s+produit|cette\s+produit|le\s+produit|same\s+product)/.test(t) ||
      /(?:change|replace|swap|update)\s+(?:the\s+)?(?:product\s+)?(?:image|photo|picture|bild)/.test(t) ||
      /(?:make|generate|create)\s+(?:other|more|extra|new|ai|display|additional)\s+(?:images?|photos?|pictures?)/.test(t) ||
      /(?:other|more|extra|display|additional)\s+(?:images?|photos?).*(?:product|produit|produkt)/.test(t) ||
      (sessionCtx.focusedProductId != null && wantsFocusedProductImageEdit(text))
    ) {
      return true;
    }
    return false;
  }

  function wantsFocusedProductImageEdit(text) {
    if (sessionCtx.focusedProductId == null) return false;
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    if (inferSiteImageSlot(text)) return false;
    return (
      /^(?:the\s+)?(?:image|photo|picture|model|shot|clothes?|garment)\s*\.?$/.test(t) ||
      /(?:change|replace|swap|update|new|different|another)\s+(?:the\s+)?(?:model|mannequin|photo|image|picture|shot)/.test(t) ||
      /(?:model|mannequin|portrait)\s+(?:for|of|on|with)/.test(t) ||
      /(?:for|of)\s+(?:the\s+)?(?:clothes?|clothing|garment|outfit|product)/.test(t) ||
      /(?:clothes?|clothing|garment|outfit).*(?:model|image|photo)/.test(t) ||
      /(?:change|replace).*(?:clothes?|clothing|garment|model)/.test(t) ||
      /\bthis\s+(?:model|image|photo)\b/.test(t)
    );
  }

  function defaultGalleryShots(text) {
    const t = String(text || '').toLowerCase();
    const clothing = /cloth|clothing|vetement|vêtement|robe|dress|wear|outfit|child|kid/.test(t);
    const base = clothing
      ? 'Same garment as reference, professional clothing catalog flat lay on cream linen'
      : 'Same product as reference, professional Scandinavian e-commerce flat lay on neutral background';
    return [
      base + ', full item visible, soft natural light',
      'Close-up detail shot of material texture, same product',
      'Lifestyle Nordic minimalist interior scene featuring the same product',
    ];
  }

  function convertAddToExistingActions(action, text, files, intent) {
    if (wantsMultipleDifferentProducts(text, files)) return null;
    if (explicitWantsNewProduct(text) && !refersExistingProduct(text, files)) return null;

    const match =
      action.match ||
      (refersExistingProduct(text, files) || sessionCtx.focusedProductId != null ? 'focused' : action.name || 'last');
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

    if (refersExistingProduct(text, files) || findProductFromContext(match, text) || sessionCtx.focusedProductId != null) {
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
      return out.length ? out : [{ type: 'update_product_image', match, imageIndex: refIdx }];
    }

    return null;
  }

  function explicitWantsNewProduct(text) {
    if (wantsCreateOrGenerateImage(text)) return false;
    const t = normalizeUserIntentText(text).toLowerCase().trim();
    if (!t) return false;
    if (
      /(?:update|change|replace|swap|modify|edit|fix|delete|remove|hero|header|site|section|manifesto|headline|title|text|price|featured|fashion card|mode card|maison|lifestyle|gallery|display image|andra bild|fler bild)/.test(
        t
      )
    ) {
      return false;
    }
    if (/(?:this|the|same|focused|den här|ce|cette)\s+product/.test(t) && !/(?:new|add|create|another product)/.test(t)) {
      return false;
    }
    return (
      /(?:add|create|lägg till|ajouter|créer|ny)\s+(?:a\s+)?(?:new\s+)?(?:products?|produits?|produkter?|items?|listings?)/.test(t) ||
      /\bnew products?\b/.test(t) ||
      /(?:add|lägg till).*(?:shop|catalog|boutique|inventory|sortiment)/.test(t) ||
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
        const converted = convertAddToExistingActions(action, text, files, intent);
        if (converted) {
          converted.forEach((a) => out.push(a));
          return;
        }
        if (!explicitWantsNewProduct(text)) return;
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

  function buildAddProductActions(text, files, opts) {
    const imgs = files || [];
    const t = String(text || '').toLowerCase();
    const nameMatch =
      text.match(/(?:named?|called|namn|nom|name)\s*[:\-]\s*["']?([^"'\n]+?)["']?$/i) ||
      text.match(/(?:product|produkt|produit)\s*[:\-]\s*["']?([^"'\n]+?)["']?$/i);
    const priceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kr|€|eur|sek)?/i);
    const catMatch = text.match(/\b(mode|maison|lifestyle|fashion|home|édition limitée|edition limitee)\b/i);
    const wantsGallery =
      (opts && opts.generateGallery) ||
      /gallery|display|bilder|images|description|title|titre|namn|listing|fiche/.test(t);

    return imgs.map((_, i) => ({
      type: 'add_product',
      name:
        nameMatch && imgs.length === 1
          ? nameMatch[1].trim()
          : imgs.length > 1
            ? 'New product ' + (i + 1)
            : text.trim().slice(0, 80) || 'New product',
      category: catMatch ? catMatch[1] : 'Mode',
      price: priceMatch ? parseFloat(String(priceMatch[1]).replace(',', '.')) : 89,
      stock: 5,
      desc: '',
      imageIndex: i,
      generateGallery: wantsGallery && imgs.length === 1,
      galleryShots: wantsGallery
        ? [
            'Flat lay catalog shot on neutral background',
            'Detail close-up of material',
            'Lifestyle Scandinavian interior',
          ]
        : [],
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
      (wantsNewImage ||
        /(?:change|replace|swap|update|edit|modify|fix|ändra|byt|remplacer|changer|modifier|mettre à jour)/.test(t) ||
        /(?:different|another|new)\s+(?:image|photo|picture|bild|model|mannequin)/.test(t) ||
        /create\s+(?:a\s+)?different\s+(?:image|photo|picture|bild)/.test(t) ||
        (hasImages && /\bthis\s+(?:model|image|photo|picture|shot)\b/.test(t)) ||
        (hasImages && /(?:change|replace|make)\s+this\b/.test(t)) ||
        /(?:for|of|on|to)\s+(?:this|the|that)\s+product/.test(t) ||
        /\bthis\s+product\b/.test(t) ||
        /(?:den\s+här|denna|det\s+här|ce\s+produit|cette\s+produit|le\s+produit)/.test(t) ||
        wantsAppendToOne ||
        (hasImages && !t.trim()) ||
        (/(?:generate|create|make).*(?:image|photo|bild)/.test(t) &&
          /(?:for|this|product|produit|produkt)/.test(t)));

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
      (refersExistingProduct(text, files) ||
        wantsImagesOnOneProduct(text, files) ||
        /(?:product|produit|produkt|this|focused|den här|ce produit)/.test(t) ||
        sessionCtx.focusedProductId != null);

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

    (actions || []).forEach((action) => {
      let a = { ...action };
      if (!a.type && a.match) a.type = 'update_product';
      if (!a.type) return;

      if (a.type === 'add_product') {
        if (wantsMultipleDifferentProducts(text, files)) {
          flat.push(a);
          return;
        }
        const converted = convertAddToExistingActions(a, text, files, intent);
        if (converted) {
          converted.forEach((c) => flat.push(c));
          return;
        }
      }

      flat.push(a);
    });

    const rewritten = rewriteMisclassifiedActions(flat, text, files);
    return expandMultiImageActions(rewritten, text, files);
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
    const key = geminiKey();
    if (!key) throw new Error(cloudAISetupMessage());
    const models = imageModels();
    const imageSize = getCfg().geminiImageSize || '2K';
    const aspectRatio = getCfg().geminiImageAspect || '3:4';
    const fullPrompt = brandPrefix() + prompt + ' Photorealistic, high-end catalog quality, no text or watermarks.';

    const parts = [{ text: fullPrompt }];
    if (referenceDataUrl) {
      const ref = dataUrlToGeminiPart(referenceDataUrl);
      if (ref) parts.push(ref);
    }

    let lastErr = null;
    for (const model of models) {
      const url = geminiModelUrl(model);
      const body = buildGeminiImageRequest(parts, aspectRatio, imageSize);

      if (onProgress) onProgress();
      try {
        const res = await fetch(url, geminiFetchOptions(key, body));

        if (!res.ok) {
          const err = await res.text();
          lastErr = new Error('Image model (' + model + '): ' + err.slice(0, 240));
          if (res.status === 404 || /not found|invalid model/i.test(err)) continue;
          if (res.status === 400 && /response_format|aspect_ratio|image_size/i.test(err)) continue;
          throw lastErr;
        }

        const data = await res.json();
        const candidate = data.candidates && data.candidates[0];
        const respParts = (candidate && candidate.content && candidate.content.parts) || [];
        for (const part of respParts) {
          const dataUrl = geminiPartToDataUrl(part);
          if (dataUrl) return compressImage(dataUrl, 2400);
        }
        lastErr = new Error('No image returned from ' + model);
      } catch (e) {
        lastErr = e;
        if (/404|not found|invalid model/i.test(String(e.message))) continue;
        throw e;
      }
    }
    throw lastErr || new Error('Image generation failed');
  }

  async function buildGalleryImages(referenceDataUrl, shots, onProgress) {
    const prompts = (shots || []).slice(0, MAX_GALLERY_SHOTS);
    const out = [];
    for (let i = 0; i < prompts.length; i++) {
      if (onProgress) onProgress(i + 1, prompts.length);
      try {
        const img = await generateProductImage(prompts[i], referenceDataUrl, null);
        if (img) out.push(img);
      } catch (e) {
        console.warn('gallery shot failed', i, e);
      }
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
    return {
      products: JSON.parse(JSON.stringify(S().getProducts())),
      siteAssets: JSON.parse(JSON.stringify(global.MD3SiteAssets ? global.MD3SiteAssets.load() : {})),
      langOverrides: JSON.parse(
        JSON.stringify(global.MD3Lang && global.MD3Lang.getOverrides ? global.MD3Lang.getOverrides() : {})
      ),
    };
  }

  async function applySnapshot(snap) {
    if (!snap) return;
    await S().saveProducts(snap.products || []);
    if (global.MD3SiteAssets) {
      global.MD3SiteAssets.save(snap.siteAssets || {});
      global.MD3SiteAssets.applyToDocument();
    }
    if (global.MD3Lang && global.MD3Lang.restoreOverrides) {
      global.MD3Lang.restoreOverrides(snap.langOverrides || {});
    }
    S().syncHomeFeaturedFlags();
    if (typeof renderAdminProducts === 'function') renderAdminProducts();
    if (typeof adminTab === 'function' && typeof adminTabActive !== 'undefined') adminTab(adminTabActive);
  }

  function snapshotsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
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
    } finally {
      busy = false;
    }
  }

  async function redoTurn(turnId) {
    const entry = turnSnapshots.find((t) => t.id === turnId);
    if (!entry || busy) return;
    busy = true;
    try {
      await applySnapshot(entry.after);
      redoStack = redoStack.filter((r) => r.turnId !== turnId);
      const redoBtn = document.querySelector('.admin-ai-redo[data-turn="' + turnId + '"]');
      const undoBtn = document.querySelector('.admin-ai-undo[data-turn="' + turnId + '"]');
      if (redoBtn) redoBtn.remove();
      if (undoBtn) {
        undoBtn.disabled = false;
        undoBtn.textContent = msg('admin-ai-undo', 'Undo');
      }
      persistChatSession();
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

  async function executeAction(action, files, onProgress) {
    const type = action.type;
    const imgIdx = action.imageIndex != null ? action.imageIndex : 0;
    const img = files[imgIdx] && files[imgIdx].dataUrl;

    if (type === 'set_site_image' || type === 'set_hero_image' || type === 'set_fashion_image') {
      if (!img) return msg('admin-ai-need-image', 'Attach an image with + first.');
      let slot = type === 'set_hero_image' ? 'hero' : type === 'set_fashion_image' ? 'fashion' : resolveSiteSlot(action);
      if (!slot) slot = resolveSiteSlot({ slot: sessionCtx.lastUserText || '' });
      if (!slot) return msg('admin-ai-err-slot', 'Which section? Try: hero, fashion, maison, lifestyle, limited, manifesto.');
      const url = await compressImage(img, slot === 'hero' ? 3840 : 2400);
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
      const langs =
        !action.lang || action.lang === 'all'
          ? ['fr', 'en', 'ar']
          : ['fr', 'en', 'ar'].includes(String(action.lang))
            ? [String(action.lang)]
            : [currentLangCode()];
      const all = global.MD3Lang.getOverrides();
      langs.forEach((lang) => {
        if (!all[lang]) all[lang] = {};
        all[lang][key] = value;
      });
      if (global.MD3Lang.restoreOverrides) global.MD3Lang.restoreOverrides(all);
      return msg('admin-ai-done-site-text', 'Site text updated: ') + esc(key);
    }

    if (type === 'delete_product' || type === 'remove_product') {
      const target = findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '');
      if (!target) return productNotFoundMessage();
      const products = S().getProducts().filter((p) => p.id !== target.id);
      await S().saveProducts(products);
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-delete', 'Product removed: ') + esc(target.name);
    }

    if (type === 'seed_defaults') {
      await S().saveProducts(S().defaultProducts());
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-seed', 'All default products restored and featured items set.');
    }

    if (type === 'generate_product_images' || type === 'append_product_images') {
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
          msg('admin-ai-done-gallery', 'Gallery updated for ') +
          esc(target.name) +
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

      const shots =
        action.galleryShots ||
        action.shots ||
        action.prompts || [
          'Flat lay on neutral linen, full item visible, studio catalog shot',
          'Close-up detail of material texture and craftsmanship',
          'Lifestyle scene in a bright Nordic minimalist interior',
        ];

      if (onProgress) {
        setLastBubble(
          esc(msg('admin-ai-generating', 'Generating product images…')) +
            ' <span class="admin-ai-typing">' +
            esc(target.name) +
            ' (' +
            shots.length +
            ')</span>'
        );
      }

      const generated = await buildGalleryImages(reference, shots, (n, total) => {
        if (onProgress) {
          setLastBubble(
            esc(msg('admin-ai-generating', 'Generating product images…')) +
              ' ' +
              esc(target.name) +
              ' — ' +
              n +
              '/' +
              total
          );
        }
      });

      const replaceGallery = action.replaceGallery || action.replaceImages;
      let nextImages;
      if (type === 'append_product_images') {
        nextImages = existing.concat(attachIdxs).concat(generated);
      } else if (replaceGallery) {
        nextImages = attachIdxs.length ? attachIdxs.concat(generated) : [reference].concat(generated);
      } else {
        nextImages = [reference].concat(generated);
      }

      products[idx] = S().normalizeProductFields({
        ...products[idx],
        images: nextImages,
        image: nextImages[0],
      });
      await S().saveProducts(products, { onlyIds: [target.id] });
      trackProduct(target.name);
      return (
        msg('admin-ai-done-gallery', 'Gallery updated for ') +
        esc(target.name) +
        ' (' +
        nextImages.length +
        ' ' +
        msg('admin-ai-images', 'images') +
        ')'
      );
    }

    if (type === 'replace_product_image' || type === 'regenerate_product_image') {
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

      const prompt =
        action.prompt ||
        action.description ||
        buildImageEditPrompt(sessionCtx.lastUserText || '') ||
        'Same product as the reference, fresh professional e-commerce catalog photo with different angle, lighting, and Scandinavian minimal styling';

      if (onProgress) {
        setLastBubble(
          esc(msg('admin-ai-generating', 'Generating product images…')) +
            ' <span class="admin-ai-typing">' +
            esc(target.name) +
            '</span>'
        );
      }

      const newImg = await generateProductImage(prompt, reference, () => {
        if (onProgress) {
          setLastBubble(
            esc(msg('admin-ai-generating', 'Generating product images…')) + ' ' + esc(target.name)
          );
        }
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
      const slotNote =
        existing.length > 1
          ? ' (' + msg('admin-ai-image-slot', 'image') + ' ' + (catalogSlot + 1) + '/' + nextImages.length + ')'
          : '';
      return msg('admin-ai-done-image', 'Image updated for ') + esc(target.name) + slotNote;
    }

    if (type === 'add_product' || type === 'update_product') {
      const products = S().getProducts();
      let target =
        type === 'update_product'
          ? findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '')
          : null;
      const category = S().canonicalCategory(action.category || 'Mode');
      const sub = action.sub || 'Vêtements';
      const price = Number(action.price) || 0;
      const stock = Math.max(0, parseInt(action.stock, 10) || 5);
      const desc = action.desc || action.description || '';
      let name = action.name || (target && target.name);
      if (!name && type === 'add_product' && !target) {
        if (wantsMultipleDifferentProducts(sessionCtx.lastUserText || '', files)) {
          const idx = (resolveImageIndices(action, files)[0] || 0) + 1;
          name = 'Product ' + idx;
        } else {
          return msg('admin-ai-err-name', 'Product name missing.');
        }
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
        if (onProgress) {
          setLastBubble(
            esc(msg('admin-ai-generating', 'Generating product images…')) +
              ' <span class="admin-ai-typing">' +
              esc(name) +
              '</span>'
          );
        }
        const extra = await buildGalleryImages(productImages[0], galleryShots, (n, total) => {
          if (onProgress) {
            setLastBubble(
              esc(msg('admin-ai-generating', 'Generating product images…')) +
                ' ' +
                esc(name) +
                ' — ' +
                n +
                '/' +
                total
            );
          }
        });
        productImages = [productImages[0]].concat(extra);
      }

      if (type === 'add_product' && !target) {
        const existingCtx = findProductFromContext(action.match || action.name || 'focused', sessionCtx.lastUserText || '');
        if (
          (refersExistingProduct(sessionCtx.lastUserText || '', files) || sessionCtx.focusedProductId != null) &&
          existingCtx &&
          !explicitWantsNewProduct(sessionCtx.lastUserText || '') &&
          !wantsMultipleDifferentProducts(sessionCtx.lastUserText || '', files)
        ) {
          const redirect = convertAddToExistingActions(
            action,
            sessionCtx.lastUserText || '',
            files,
            classifyIntent(sessionCtx.lastUserText || '', files)
          );
          if (redirect && redirect.length) {
            const lines = [];
            for (const sub of redirect) {
              const line = await executeAction(sub, files, onProgress);
              if (line) lines.push(line);
            }
            return lines.join('<br>');
          }
        }

        const id = nextProductId(products);
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
        };
        if (productImages.length) {
          item.images = productImages;
          item.image = productImages[0];
        }
        products.push(S().normalizeProductFields(item));
        await S().saveProducts(products, { onlyIds: [id] });
        S().syncHomeFeaturedFlags();
        trackProduct(name);
        const imgNote = productImages.length > 1 ? ' (' + productImages.length + ' images)' : '';
        return msg('admin-ai-done-add', 'Product added: ') + esc(name) + imgNote;
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
      const ids = Array.isArray(action.ids) ? action.ids : S().HOME_FEATURED_IDS;
      const idSet = new Set(ids.map((id) => Number(id)).filter((n) => Number.isFinite(n)));
      const products = S().getProducts().map((p) => ({
        ...p,
        featured: idSet.has(Number(p.id)),
      }));
      await S().saveProducts(products);
      return msg('admin-ai-done-featured', 'Featured products updated.');
    }

    return null;
  }

  async function executeAll(actions, files, onProgress) {
    const before = captureSnapshot();
    const lines = [];
    for (const action of actions) {
      try {
        const line = await executeAction(action, files, onProgress);
        if (line) lines.push(line);
      } catch (e) {
        console.error('admin ai action', e);
        lines.push((e && e.message) || String(e));
      }
    }
    if (typeof renderAdminProducts === 'function') renderAdminProducts();
    if (typeof adminTab === 'function' && typeof adminTabActive !== 'undefined') adminTab(adminTabActive);
    const after = captureSnapshot();
    const html = lines.length
      ? lines.join('<br>')
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

    if ((intent.wantsAddMultiple || intent.wantsAdd) && imgs.length && explicitWantsNewProduct(text)) {
      return buildAddProductActions(text, imgs);
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

    if (!actions.length && imgs.length && sessionCtx.focusedProductId != null && !explicitWantsNewProduct(text)) {
      if (imgs.length > 1) {
        actions.push({
          type: 'append_product_images',
          match: 'focused',
          imageIndices: imgs.map((_, i) => i),
        });
      } else if (wantsCreateOrGenerateImage(text) || intent.wantsAiGenerate || !t.trim()) {
        actions.push(buildImageGenerateAction(text, imgs));
      } else {
        actions.push({ type: 'update_product_image', match: 'focused', imageIndex: 0 });
      }
      return actions;
    }

    if (!actions.length && imgs.length && (wantsCreateOrGenerateImage(text) || intent.wantsAiGenerate || (!t.trim() && imgs.length === 1))) {
      return [buildImageGenerateAction(text, imgs)];
    }

    if (!actions.length && wantsCreateOrGenerateImage(text) && sessionCtx.resolvedProductId != null) {
      return [buildImageGenerateAction(text, imgs)];
    }

    if (!actions.length && sessionCtx.focusedProductId != null && wantsFocusedProductImageEdit(text)) {
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
    if (imgs.length && (wantsCreateOrGenerateImage(text) || refersAttachedImageEdit(text, imgs))) {
      return [buildImageGenerateAction(text, imgs)];
    }
    if (sessionCtx.focusedProductId != null && wantsFocusedProductImageEdit(text)) {
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

  async function callGemini(text, files) {
    const key = geminiKey();
    const system = buildSystemPrompt();
    const contents = buildGeminiContents();
    let lastErr = null;

    for (const model of chatModels()) {
      const url = geminiModelUrl(model);
      try {
        const res = await fetch(
          url,
          geminiFetchOptions(key, {
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              temperature: 0.35,
              responseMimeType: 'application/json',
            },
          })
        );

        if (!res.ok) {
          const err = await res.text();
          lastErr = new Error('Gemini (' + model + '): ' + err.slice(0, 280));
          if (res.status === 404 || /not found|invalid model/i.test(err)) continue;
          throw lastErr;
        }

        const data = await res.json();
        const raw =
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts &&
          data.candidates[0].content.parts.map((p) => p.text).join('');
        return parseAiJson(raw);
      } catch (e) {
        lastErr = e;
        if (/404|not found|invalid model/i.test(String(e.message))) continue;
        throw e;
      }
    }
    throw lastErr || new Error('No Gemini model available');
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
    const provider = (getCfg().provider || 'gemini').toLowerCase();
    if (provider === 'openai' && hasOpenAI()) return callOpenAI(text, files);
    if (hasGemini()) return callGemini(text, files);
    if (hasOpenAI()) return callOpenAI(text, files);
    return null;
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

    if (
      workFiles.length &&
      (refersAttachedImageEdit(text, workFiles) ||
        wantsCreateOrGenerateImage(text) ||
        !normalizeUserIntentText(text))
    ) {
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

      if (!actions.length) {
        const intro = parsed && parsed.reply ? esc(parsed.reply) + '<br>' : '';
        let hint = '';
        if (cloudErr) {
          hint =
            '<br><small class="admin-ai-hint admin-ai-hint--err">' +
            esc(formatCloudError(cloudErr)) +
            '</small>';
        } else if (!hasCloudAI() && sessionCtx.focusedProductId != null) {
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
        busy = false;
        if (sendBtn) sendBtn.disabled = false;
        return;
      }

      const exec = await executeAll(actions, workFiles, true);
      const intro = parsed && parsed.reply ? esc(parsed.reply) + '<br>' : '';
      replyHtml = finalizeAssistantReply({ ...exec, html: intro + exec.html });

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
      const fallback = inferActionsWhenEmpty(text, getEffectiveFiles(text, sessionCtx.lastFiles || []), null);
      if (fallback.length) {
        try {
          const exec = await executeAll(fallback, getEffectiveFiles([], text), true);
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
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
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
    const issue = geminiKeyIssue();
    if (!issue && hasGemini()) {
      el.hidden = true;
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
