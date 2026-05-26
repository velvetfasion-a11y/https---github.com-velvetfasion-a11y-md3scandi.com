/** Send verification emails via EmailJS */
(function (global) {
  function isConfigured() {
    const c = global.MD3_EMAIL_CONFIG;
    return c && c.serviceId && c.templateId && c.publicKey;
  }

  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function sendVerificationCode(email, code, name) {
    const cfg = global.MD3_EMAIL_CONFIG;
    if (!isConfigured()) {
      const err = new Error('EMAIL_NOT_CONFIGURED');
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          to_email: email,
          email: email,
          code: code,
          passcode: code,
          user_name: name || '',
          name: name || '',
          reply_to: email,
        },
      }),
    });

    if (!res.ok) {
      const err = new Error('SEND_FAILED');
      err.code = 'SEND_FAILED';
      throw err;
    }
    return true;
  }

  global.MD3Email = {
    isConfigured,
    generateCode,
    sendVerificationCode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
