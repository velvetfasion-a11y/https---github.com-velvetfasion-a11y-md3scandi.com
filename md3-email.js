/** Send verification emails via EmailJS */
(function (global) {
  function isConfigured() {
    const c = global.MD3_EMAIL_CONFIG;
    return c && c.serviceId && c.templateId && c.publicKey;
  }

  function isOrderConfigured() {
    const c = global.MD3_EMAIL_CONFIG;
    return c && c.serviceId && (c.orderTemplateId || c.ownerOrderTemplateId || c.templateId) && c.publicKey;
  }

  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function sendEmail(templateId, params) {
    const cfg = global.MD3_EMAIL_CONFIG;
    if (!cfg || !cfg.serviceId || !templateId || !cfg.publicKey) {
      const err = new Error('EMAIL_NOT_CONFIGURED');
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: templateId,
        user_id: cfg.publicKey,
        template_params: params || {},
      }),
    });

    if (!res.ok) {
      const err = new Error('SEND_FAILED');
      err.code = 'SEND_FAILED';
      throw err;
    }
    return true;
  }

  async function sendVerificationCode(email, code, name) {
    const cfg = global.MD3_EMAIL_CONFIG;
    return sendEmail(cfg && cfg.templateId, {
      to_email: email,
      email: email,
      code: code,
      passcode: code,
      user_name: name || '',
      name: name || '',
      reply_to: email,
    });
  }

  async function sendVerificationLink(email, link, name) {
    const cfg = global.MD3_EMAIL_CONFIG;
    return sendEmail(cfg && cfg.templateId, {
      to_email: email,
      email: email,
      verification_link: link,
      link: link,
      user_name: name || '',
      name: name || '',
      reply_to: email,
    });
  }

  async function sendOrderEmail(params) {
    const cfg = global.MD3_EMAIL_CONFIG;
    const templates = [cfg && (cfg.orderTemplateId || cfg.templateId), cfg && cfg.ownerOrderTemplateId]
      .filter(Boolean)
      .filter((id, idx, arr) => arr.indexOf(id) === idx);
    if (!templates.length) return sendEmail('', params);
    for (const templateId of templates) {
      await sendEmail(templateId, params);
    }
    return true;
  }

  global.MD3Email = {
    isConfigured,
    isOrderConfigured,
    generateCode,
    sendVerificationCode,
    sendVerificationLink,
    sendOrderEmail,
  };
})(typeof window !== 'undefined' ? window : globalThis);
