/**
 * Global Express error handler.
 * Must be the last middleware registered in index.js.
 */
export function errorHandler(err, req, res, next) {
  // Multer file errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB || 10}MB.`,
    });
  }

  if (err.message?.startsWith('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }

  // Supabase or known operational errors
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }

  // Unknown errors — log and return generic message (never leak stack traces in prod)
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
}
