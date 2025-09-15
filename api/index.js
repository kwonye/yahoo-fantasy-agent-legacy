// Vercel serverless entry that wraps the Express app
// Legacy: api/index.js replaced by Next.js API routes.
// Kept as a small fallback in case something still requires it.
module.exports = (req, res) => {
  res.status(410).send('Legacy API entry removed; use Next API routes under /api/*');
};
