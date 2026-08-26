import multer from 'multer';

// one place to catch errors so the route files don't need try/catch everywhere,
// keeps the error responses consistent for the frontend too
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `upload error: ${err.message}` });
  }

  if (err) {
    console.error(err);
    // err.status is only ever set deliberately (see middleware/upload.js)
    // for a message that's meant to be shown to whoever made the request.
    // Anything that reaches here without one is a genuine unexpected
    // failure -- a db error, a bug -- and its .message can contain real
    // internals (query fragments, file paths, library details) that have
    // no business leaving the server. Those get logged above and replaced
    // with a generic message; only the deliberate, already-safe ones pass
    // their text through.
    const status = err.status || 500;
    const message = err.status ? err.message : 'internal server error';
    return res.status(status).json({ error: message });
  }

  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: `route not found: ${req.method} ${req.originalUrl}` });
}
