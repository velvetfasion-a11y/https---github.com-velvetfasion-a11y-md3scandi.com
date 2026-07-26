const { verifyAdmin } = require('./admin-upload.js');
const { runAdminAiImage, runAdminAiPrompt } = require('./admin-ai-logic.js');

async function handleAdminAiPrompt(req, res) {
  try {
    const user = await verifyAdmin(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized — sign in as admin again' });

    const result = await runAdminAiPrompt(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('admin-ai prompt failed:', error);
    return res.status(error?.status || 500).json({
      error: error?.message || 'AI assistant could not reply',
    });
  }
}

async function handleAdminAiImage(req, res) {
  try {
    const user = await verifyAdmin(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized — sign in as admin again' });

    const result = await runAdminAiImage(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('admin-ai image failed:', error);
    return res.status(error?.status || 500).json({
      error: error?.message || 'AI image could not be created',
    });
  }
}

module.exports = {
  handleAdminAiPrompt,
  handleAdminAiImage,
};
