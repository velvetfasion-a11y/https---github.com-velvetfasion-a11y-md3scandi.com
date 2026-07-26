/** Shared Gemini admin-AI logic (local API + Cloud Functions) — MD3 Scandi. */

const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash';
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image';
const MAX_PRODUCTS = 100;
const MAX_ATTACHMENTS = 4;
const MAX_ACTIONS = 8;

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function modelUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isMissingModelError(error) {
  return (
    error?.status === 404 ||
    /model.*(?:not found|unsupported|no longer available)|not found.*model/i.test(error?.message || '')
  );
}

async function callGemini(model, body, attempt = 1) {
  const key = geminiKey();
  if (!key) {
    const error = new Error('GEMINI_API_KEY missing');
    error.status = 503;
    throw error;
  }

  const response = await fetch(modelUrl(model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    if (isRetryableStatus(response.status) && attempt < 3) {
      await sleep(400 * attempt * attempt);
      return callGemini(model, body, attempt + 1);
    }
    throw error;
  }
  return payload;
}

async function callGeminiWithFallback(models, body) {
  const uniqueModels = [...new Set(models.filter(Boolean))];
  let lastError = null;

  for (const model of uniqueModels) {
    try {
      return { payload: await callGemini(model, body), model };
    } catch (error) {
      lastError = error;
      if (isMissingModelError(error) || isRetryableStatus(error?.status)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('No compatible Gemini model found');
}

function responseParts(payload) {
  return payload?.candidates?.[0]?.content?.parts || [];
}

function responseText(payload) {
  return responseParts(payload)
    .map((part) => part.text || '')
    .join('')
    .trim();
}

function extractJsonCandidate(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  const object = raw.match(/\{[\s\S]*\}/)?.[0];
  return (object || raw).trim();
}

function repairJsonText(text) {
  let out = String(text || '').trim();
  out = out.replace(/,(\s*[}\]])/g, '$1');
  out = out.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  out = out.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  return out;
}

function parseJsonResponse(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error('AI response did not contain valid JSON');

  const attempts = [candidate, repairJsonText(candidate)];
  let lastError = null;

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('AI response did not contain valid JSON');
}

async function repairAiJson(rawText, models) {
  const { payload } = await callGeminiWithFallback(models, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Fix this into valid minified JSON only. ' +
              'Required shape: {"reply":"...","actions":[...]}. ' +
              'Do not add markdown. Do not explain.\n\nBroken JSON:\n' +
              String(rawText || '').slice(0, 12000),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });
  return parseJsonResponse(responseText(payload));
}

function sanitizeProducts(products) {
  return (Array.isArray(products) ? products : []).slice(0, MAX_PRODUCTS).map((product) => {
    const images = Array.isArray(product?.images)
      ? product.images
      : product?.image
        ? [product.image]
        : [];
    return {
      id: String(product?.id || ''),
      name: String(product?.name || '').slice(0, 120),
      category: String(product?.category || '').slice(0, 40),
      sub: String(product?.sub || '').slice(0, 40),
      description: String(product?.desc || product?.description || '').slice(0, 280),
      price: Number(product?.price) || 0,
      stock: Number(product?.stock) || 0,
      featured: !!product?.featured,
      imageCount: images.length,
      primaryImage: String(images[0] || '').slice(0, 180),
    };
  });
}

function dataUrlPart(dataUrl) {
  const match = /^data:([^;]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match || !match[1].startsWith('image/')) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2].replace(/\s/g, ''),
    },
  };
}

function chatSystemPrompt(products) {
  return `You are the secure MD3 Scandi shop-admin assistant.
Convert the administrator's natural-language request into safe structured product / site actions.

Return ONLY one valid compact JSON object. No markdown. No trailing commas. Escape all quotes inside strings.
Shape:
{"reply":"","actions":[...]}

Allowed actions:
- {"type":"create_product","name":"...","category":"Mode|Maison|Lifestyle|Édition limitée","sub":"...","description":"...","price":0,"stock":5,"featured":false,"attachmentIndices":[0],"generateImagePrompts":["..."]}
- {"type":"update_product","target":"exact product id or name","changes":{"name":"...","category":"...","sub":"...","description":"...","price":0,"stock":5,"featured":false}}
- {"type":"delete_product","target":"exact product id or name"}
- {"type":"generate_product_images","target":"exact product id or name","prompts":["model wearing garment...","detail view..."],"replaceMain":false,"referenceAttachmentIndex":0}
- {"type":"set_site_image","slot":"hero|fashion|maison|lifestyle|limited|manifesto","attachmentIndex":0}
- {"type":"set_site_text","key":"hero-subtitle|featured-title|manifesto","value":"...","lang":"all"}

Rules:
- reply MUST be "" (empty). The UI shows short status lines only.
- Never invent an existing target. Use an exact id or name from Current products.
- Only create a product if the user clearly says create/add/make/new product.
- Only delete when the user explicitly asks to delete/remove.
- DEFAULT for attached product photos without clear "this product / change this" language = create_product (new catalogue rows). Never overwrite because a photo looks similar.
- For "change/update this product" or "different images / model wear this product", use Focused product if present; otherwise match the attached photo to Current products — use generate_product_images or update_product, NEVER create_product.
- When user asks for a model wearing the garment / mannequin / portant, generate_product_images prompts must describe a fashion model wearing the same garment from the reference.
- Keep image prompts photorealistic, Scandinavian minimal, full product visible, no text or watermark. Max 3 prompts, under 160 chars each.
- Product category must be Mode, Maison, Lifestyle, or Édition limitée.
- attachmentIndices refer to attached images in the current message, starting at 0.
- If required information is genuinely missing, return an empty actions array and a short reply question.
- Keep the whole JSON under 3500 characters.

Current products:
${JSON.stringify(products)}`;
}

function normalizeAiResult(parsed) {
  const actions = Array.isArray(parsed?.actions)
    ? parsed.actions.filter((action) => action && typeof action.type === 'string').slice(0, MAX_ACTIONS)
    : [];
  return {
    reply: String(parsed?.reply || '').slice(0, 180),
    actions,
  };
}

async function runAdminAiPrompt(body = {}) {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) {
    const error = new Error('Write an instruction first');
    error.status = 400;
    throw error;
  }
  if (prompt.length > 5000) {
    const error = new Error('Instruction is too long');
    error.status = 400;
    throw error;
  }

  const products = sanitizeProducts(body?.products);
  const attachments = (Array.isArray(body?.attachments) ? body.attachments : []).slice(
    0,
    MAX_ATTACHMENTS
  );
  const parts = [
    {
      text: `${prompt}\n\nFocused product: ${JSON.stringify(body?.focusedProduct || null)}`,
    },
  ];
  attachments.forEach((attachment, index) => {
    const imagePart = dataUrlPart(attachment?.dataUrl);
    if (imagePart) {
      parts.push({
        text: `[Attachment ${index}: ${String(attachment?.name || 'image').slice(0, 100)}]`,
      });
      parts.push(imagePart);
    }
  });

  const chatModels = [
    process.env.GEMINI_MODEL,
    DEFAULT_CHAT_MODEL,
    'gemini-flash-latest',
    'gemini-3-flash-preview',
    'gemini-3.5-flash-lite',
  ];
  const { payload } = await callGeminiWithFallback(chatModels, {
    systemInstruction: { parts: [{ text: chatSystemPrompt(products) }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });

  const raw = responseText(payload);
  let parsed;
  try {
    parsed = parseJsonResponse(raw);
  } catch (parseError) {
    console.warn('admin-ai JSON parse failed, repairing:', parseError?.message);
    parsed = await repairAiJson(raw, chatModels);
  }

  return normalizeAiResult(parsed);
}

async function runAdminAiImage(body = {}) {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) {
    const error = new Error('An image instruction is required');
    error.status = 400;
    throw error;
  }
  if (prompt.length > 2500) {
    const error = new Error('Image instruction is too long');
    error.status = 400;
    throw error;
  }

  const parts = [
    {
      text:
        'Create a photorealistic Scandinavian e-commerce product image. ' +
        'Show the complete product, preserve garment design and proportions, use soft natural light, ' +
        'no text, logos, borders, or watermarks. ' +
        prompt,
    },
  ];
  const reference = dataUrlPart(body?.referenceDataUrl);
  if (reference) parts.push(reference);

  const imageSize = String(process.env.GEMINI_IMAGE_SIZE || '2K');
  const { payload, model } = await callGeminiWithFallback(
    [
      process.env.GEMINI_IMAGE_MODEL,
      DEFAULT_IMAGE_MODEL,
      'gemini-3.1-flash-image',
      'gemini-2.5-flash-image',
      'gemini-3-pro-image-preview',
    ],
    {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: String(process.env.GEMINI_IMAGE_ASPECT || '3:4'),
          imageSize,
        },
      },
    }
  );

  const imagePart = responseParts(payload).find((part) => part.inlineData || part.inline_data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) throw new Error('Image model returned no image');
  const mime = inline.mimeType || inline.mime_type || 'image/png';

  return {
    dataUrl: `data:${mime};base64,${inline.data}`,
    model,
  };
}

module.exports = {
  runAdminAiPrompt,
  runAdminAiImage,
  sanitizeProducts,
  geminiKey,
};
