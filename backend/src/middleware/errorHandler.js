import multer from 'multer';

// one place to catch errors so the route files don't need try/catch everywhere,
// keeps the error responses consistent for the frontend too
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `upload error: ${err.message}` });
  }

  if (err) {
    console.error(err);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'internal server error' });
  }

  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: `route not found: ${req.method} ${req.originalUrl}` });
}
