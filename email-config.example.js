/**
 * Copy this file to email-config.js and fill in your EmailJS credentials.
 * Setup: https://www.emailjs.com/ (free tier works for instant emails)
 *
 * Create a verification template with variables: {{code}}, {{user_name}}, {{to_email}}
 * Create an order template with variables like:
 * {{order_number}}, {{order_date}}, {{order_total}},
 * {{item1_name}}, {{item1_category}}, {{item1_image}}, {{item1_qty}}, {{item1_price}}
 * Set "To Email" in template to {{to_email}}
 */
window.MD3_EMAIL_CONFIG = {
  serviceId: 'YOUR_SERVICE_ID',
  templateId: 'YOUR_TEMPLATE_ID',
  orderTemplateId: 'YOUR_ORDER_TEMPLATE_ID',
  ownerOrderTemplateId: 'YOUR_OWNER_ORDER_TEMPLATE_ID',
  publicKey: 'YOUR_PUBLIC_KEY',
};
