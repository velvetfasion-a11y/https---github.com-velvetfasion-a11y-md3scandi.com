/**
 * MD3 Admin — compact AI assistant (chat box + file attach + site actions)
 */
(function (global) {
  const S = () => global.MD3Store;
  const L = (k) => (global.MD3Lang ? global.MD3Lang.t(k) : k);
  const MAX_ATTACH = 4;
  const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

  let attachments = [];
  let busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function getCfg() {
    return global.MD3_AI_CONFIG || {};
  }

  function geminiKey() {
    const k = getCfg().geminiApiKey;
    return k && !String(k).includes('YOUR_') ? k : '';
  }

  function openaiKey() {
    const k = getCfg().openaiApiKey;
    return k && !String(k).includes('YOUR_') ? k : '';
  }

  function hasGemini() {
    return !!geminiKey();
  }

  function hasOpenAI() {
    return !!openaiKey();
  }

  function hasCloudAI() {
    const p = (getCfg().provider || 'gemini').toLowerCase();
    if (p === 'openai') return hasOpenAI();
    if (p === 'gemini') return hasGemini();
    return hasGemini() || hasOpenAI();
  }

  function dataUrlToGeminiPart(dataUrl) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { inline_data: { mime_type: m[1], data: m[2] } };
  }

  function buildSystemPrompt() {
    const products = S()
      .getProducts()
      .slice(0, 20)
      .map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price, featured: p.featured }));
    return `You are MD3 Scandi admin assistant. Reply ONLY with valid JSON:
{"reply":"short friendly message","actions":[...]}

Action types:
- seed_defaults — restore all default catalogue products
- set_hero_image {imageIndex:0} — homepage header (needs attached image)
- set_fashion_image {imageIndex:0} — Mode/Fashion collection card background
- add_product {name,category,sub,price,stock,desc,featured,emoji,imageIndex} — create product; infer name/category/price from image+text when user says "add this product"
- update_product {match or name, price, desc, stock, featured, imageIndex}
- update_product_image {name, imageIndex}

Categories: Mode, Maison, Lifestyle, Édition limitée.
Subs examples: Vêtements, Canapés, Vaisselle, Déco, Textile.
Current products: ${JSON.stringify(products)}.
User may write Swedish, French, or English. Always return at least one action when user attaches a product image and asks to add it.`;
  }

  function parseAiJson(raw) {
    if (!raw) return { reply: '', actions: [] };
    const trimmed = String(raw).trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    try {
      return JSON.parse(jsonMatch ? jsonMatch[0] : trimmed);
    } catch (_) {
      return { reply: trimmed, actions: [] };
    }
  }

  function msg(key, fallback) {
    const v = L(key);
    return v && v !== key ? v : fallback;
  }

  function addBubble(role, html) {
    const box = $('adminAiMessages');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'admin-ai-msg admin-ai-msg--' + role;
    el.innerHTML = html;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
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
    const q = String(name || '')
      .trim()
      .toLowerCase();
    if (!q) return null;
    const products = S().getProducts();
    return (
      products.find((p) => p.name.toLowerCase() === q) ||
      products.find((p) => p.name.toLowerCase().includes(q)) ||
      products.find((p) => q.includes(p.name.toLowerCase()))
    );
  }

  async function executeAction(action, files) {
    const type = action.type;
    const imgIdx = action.imageIndex != null ? action.imageIndex : 0;
    const img = files[imgIdx] && files[imgIdx].dataUrl;

    if (type === 'seed_defaults') {
      await S().saveProducts(S().defaultProducts());
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-seed', 'All default products restored and featured items set.');
    }

    if (type === 'set_hero_image') {
      if (!img) return msg('admin-ai-need-image', 'Attach an image with + first.');
      const url = await compressImage(img, 3840);
      global.MD3SiteAssets.setHero(url);
      return msg('admin-ai-done-hero', 'Hero / header image updated.');
    }

    if (type === 'set_fashion_image') {
      if (!img) return msg('admin-ai-need-image', 'Attach an image with + first.');
      const url = await compressImage(img, 2000);
      global.MD3SiteAssets.setFashion(url);
      return msg('admin-ai-done-fashion', 'Fashion / Mode card background updated.');
    }

    if (type === 'add_product' || type === 'update_product') {
      const products = S().getProducts();
      let target =
        type === 'update_product'
          ? findProductByName(action.match || action.name)
          : null;
      const category = S().canonicalCategory(action.category || 'Mode');
      const sub = action.sub || 'Vêtements';
      const price = Number(action.price) || 0;
      const stock = Math.max(0, parseInt(action.stock, 10) || 1);
      const desc = action.desc || action.description || '';
      const name = action.name || (target && target.name);
      if (!name) return msg('admin-ai-err-name', 'Product name missing.');

      if (type === 'add_product' && !target) {
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
        if (img) {
          item.images = [img];
          item.image = img;
        }
        products.push(S().normalizeProductFields(item));
        await S().saveProducts(products, { onlyIds: [id] });
        S().syncHomeFeaturedFlags();
        return msg('admin-ai-done-add', 'Product added: ') + esc(name);
      }

      if (!target) target = findProductByName(name);
      if (!target) return msg('admin-ai-err-missing', 'Product not found: ') + esc(name);

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
      if (img) {
        next.images = [img];
        next.image = img;
      }
      products[idx] = S().normalizeProductFields(next);
      await S().saveProducts(products, { onlyIds: [target.id] });
      S().syncHomeFeaturedFlags();
      return msg('admin-ai-done-update', 'Product updated: ') + esc(next.name);
    }

    if (type === 'update_product_image') {
      const target = findProductByName(action.name || action.match);
      if (!target) return msg('admin-ai-err-missing', 'Product not found.');
      if (!img) return msg('admin-ai-need-image', 'Attach an image with + first.');
      const products = S().getProducts();
      const idx = products.findIndex((p) => p.id === target.id);
      products[idx] = S().normalizeProductFields({
        ...products[idx],
        images: [img],
        image: img,
      });
      await S().saveProducts(products, { onlyIds: [target.id] });
      return msg('admin-ai-done-update', 'Product updated: ') + esc(target.name);
    }

    if (type === 'set_featured') {
      const ids = Array.isArray(action.ids) ? action.ids : S().HOME_FEATURED_IDS;
      const products = S().getProducts().map((p) => ({
        ...p,
        featured: ids.includes(p.id),
      }));
      await S().saveProducts(products);
      return msg('admin-ai-done-featured', 'Featured products updated.');
    }

    return null;
  }

  async function executeAll(actions, files) {
    const lines = [];
    for (const action of actions) {
      try {
        const line = await executeAction(action, files);
        if (line) lines.push(line);
      } catch (e) {
        console.error('admin ai action', e);
        lines.push((e && e.message) || String(e));
      }
    }
    if (typeof renderAdminProducts === 'function') renderAdminProducts();
    if (typeof adminTab === 'function' && typeof adminTabActive !== 'undefined') adminTab(adminTabActive);
    return lines.length
      ? lines.join('<br>')
      : msg('admin-ai-no-action', 'I could not find a matching action. Try: “set hero image”, “fashion card”, “add product …”, or attach + image.');
  }

  function parseLocalCommands(text, files) {
    const t = text.toLowerCase();
    const actions = [];
    const imgs = files || [];

    if (
      /lägg till alla|alla produkter|standardprodukter|seed|default products|restore products|återställ produkter|add all products/.test(
        t
      )
    ) {
      actions.push({ type: 'seed_defaults' });
    }

    if (
      imgs.length &&
      /(header|hero|startbild|huvudbild|bild (högst upp|överst)|bilden högst)/.test(t)
    ) {
      actions.push({ type: 'set_hero_image', imageIndex: 0 });
    }

    if (
      imgs.length &&
      /(fashion|mode\b|stil|kollektion mode|där det står mode|där det står fashion|where it says fashion)/.test(t) &&
      !/produkt|product/.test(t)
    ) {
      actions.push({ type: 'set_fashion_image', imageIndex: 0 });
    }

    // "add this product" + attached image
    if (
      imgs.length &&
      /(?:add|lägg till|ajouter|create|new|ny)\s+(?:this\s+)?(?:product|produkt|produit)|(?:add|lägg till)\s+den\s+här|this\s+product/i.test(
        text
      )
    ) {
      const nameMatch =
        text.match(/(?:named?|called|namn|nom|name)\s*[:\-]\s*["']?([^"'\n]+?)["']?$/i) ||
        text.match(/(?:product|produkt|produit)\s*[:\-]\s*["']?([^"'\n]+?)["']?$/i);
      const priceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kr|€|eur|sek)?/i);
      const catMatch = text.match(/\b(mode|maison|lifestyle|fashion|home|édition limitée|edition limitee)\b/i);
      actions.push({
        type: 'add_product',
        name: nameMatch ? nameMatch[1].trim() : 'New product',
        category: catMatch ? catMatch[1] : 'Mode',
        price: priceMatch ? parseFloat(String(priceMatch[1]).replace(',', '.')) : 89,
        stock: 5,
        desc: '',
        imageIndex: 0,
      });
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
            })
          );
        }
      } catch (_) {}
    }

    const addMatch =
      text.match(
        /(?:lägg till|add|ny produkt|new product)\s*[:\-]?\s*([^,\n]+?)(?:\s*,\s*|\s+)(mode|maison|lifestyle|fashion|home)[^,\n]*(?:\s*,\s*|\s+)(\d+)/i
      ) ||
      text.match(/(?:lägg till|add)\s+produkt\s+(.+?)\s+(\d+)\s*(?:kr|€|eur)?/i);
    if (addMatch) {
      actions.push({
        type: 'add_product',
        name: addMatch[1].trim(),
        category: addMatch[2] || 'Mode',
        price: Number(addMatch[3] || addMatch[2]),
        stock: 5,
        imageIndex: imgs.length ? 0 : undefined,
      });
    }

    const prodImg =
      text.match(/(?:produkt|product)\s+["']?([^"'\n]+?)["']?\s*(?:bild|image|photo)/i) ||
      text.match(/(?:bild|image)\s+(?:för|for|på|on)\s+["']?([^"'\n]+?)["']?$/i);
    if (prodImg && imgs.length) {
      actions.push({ type: 'update_product_image', name: prodImg[1].trim(), imageIndex: 0 });
    }

    const priceMatch = text.match(
      /(?:pris|price)\s+(?:för|for|på|on)?\s*["']?([^"'\n]+?)["']?\s*(?:till|to|=)?\s*(\d+)/i
    );
    if (priceMatch) {
      actions.push({
        type: 'update_product',
        match: priceMatch[1].trim(),
        price: Number(priceMatch[2]),
      });
    }

    const descMatch = text.match(
      /(?:beskrivning|description)\s+(?:för|for)\s+["']?([^"'\n:]+?)["']?\s*[:\-]\s*(.+)/i
    );
    if (descMatch) {
      actions.push({
        type: 'update_product',
        match: descMatch[1].trim(),
        desc: descMatch[2].trim(),
      });
    }

    if (!actions.length && imgs.length === 1) {
      if (/(header|hero|start)/.test(t)) actions.push({ type: 'set_hero_image', imageIndex: 0 });
      else if (/(fashion|mode)/.test(t)) actions.push({ type: 'set_fashion_image', imageIndex: 0 });
      else if (text.trim()) {
        actions.push({
          type: 'add_product',
          name: text.trim().slice(0, 80) || 'New product',
          category: 'Mode',
          price: 89,
          stock: 5,
          imageIndex: 0,
        });
      }
    }

    return actions;
  }

  async function callGemini(text, files) {
    const key = geminiKey();
    const model = getCfg().geminiModel || 'gemini-2.0-flash';
    const system = buildSystemPrompt();
    const parts = [{ text: system + '\n\nUser message: ' + (text || 'Use the attached image(s).') }];
    (files || []).forEach((f, i) => {
      const imgPart = dataUrlToGeminiPart(f.dataUrl);
      if (imgPart) parts.push(imgPart);
      parts.push({ text: '[attachment ' + i + ': ' + f.name + ']' });
    });

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) +
      ':generateContent?key=' +
      encodeURIComponent(key);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error('Gemini: ' + err.slice(0, 280));
    }
    const data = await res.json();
    const raw =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts.map((p) => p.text).join('');
    return parseAiJson(raw);
  }

  async function callOpenAI(text, files) {
    const key = openaiKey();
    const model = getCfg().model || 'gpt-4o-mini';
    const system = buildSystemPrompt();

    const content = [{ type: 'text', text: text || 'Execute based on attachments.' }];
    files.forEach((f, i) => {
      content.push({ type: 'image_url', image_url: { url: f.dataUrl, detail: 'low' } });
      content.push({ type: 'text', text: `[attachment ${i}: ${f.name}]` });
    });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
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

  async function handleSend() {
    if (busy) return;
    const input = $('adminAiInput');
    const text = (input && input.value.trim()) || '';
    if (!text && !attachments.length) return;

    busy = true;
    const sendBtn = $('adminAiSendBtn');
    if (sendBtn) sendBtn.disabled = true;

    addBubble('user', esc(text) + (attachments.length ? `<div class="admin-ai-user-imgs">${attachments.map((a) => `<img src="${esc(a.dataUrl)}" alt="" />`).join('')}</div>` : ''));
    if (input) input.value = '';

    const files = attachments.slice();
    attachments = [];
    renderAttachments();

    addBubble('assistant', '<span class="admin-ai-typing">' + msg('admin-ai-thinking', 'Working…') + '</span>');

    try {
      let replyHtml;
      if (hasCloudAI()) {
        const parsed = await callCloudAI(text, files);
        let actions = (parsed && parsed.actions) || [];
        if (!actions.length) actions = parseLocalCommands(text, files);
        const exec = await executeAll(actions, files);
        const intro = parsed && parsed.reply ? esc(parsed.reply) + '<br>' : '';
        replyHtml = intro + exec;
      } else {
        const actions = parseLocalCommands(text, files);
        replyHtml = await executeAll(actions, files);
        if (!hasCloudAI() && !$('adminAiMessages').dataset.hinted) {
          replyHtml +=
            '<br><small class="admin-ai-hint">' +
            esc(msg('admin-ai-hint-local', 'Tip: add Gemini key in ai-config.js for smarter commands.')) +
            '</small>';
          $('adminAiMessages').dataset.hinted = '1';
        }
      }
      const msgs = $('adminAiMessages');
      const last = msgs && msgs.lastElementChild;
      if (last) last.innerHTML = replyHtml;
    } catch (e) {
      console.error('admin ai', e);
      const msgs = $('adminAiMessages');
      const last = msgs && msgs.lastElementChild;
      if (last) {
        last.innerHTML = esc(msg('admin-ai-err', 'Something went wrong: ')) + esc(e.message || String(e));
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

    addBubble(
      'assistant',
      esc(
        msg(
          'admin-ai-welcome',
          'Hej! Bifoga bilder med + och skriv t.ex. “sätt header-bilden”, “där det står Fashion — denna bild”, “lägg till alla produkter”, eller “produkt Robe Lin Ivoire bild”.'
        )
      )
    );
  }

  function init() {
    if (!$('adminAi') || $('adminAi').dataset.inited === '1') return;
    $('adminAi').dataset.inited = '1';
    bind();
  }

  global.MD3AdminAI = { init, handleSend, parseLocalCommands, executeAll };
})(typeof window !== 'undefined' ? window : globalThis);
