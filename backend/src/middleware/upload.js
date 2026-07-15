import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// make sure the uploads folder actually exists before multer tries to write to it
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // random filename so people can't guess urls to someone else's clip
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  },
});

// just check it's audio or video, nothing more specific than that.
// browsers report mimetypes with a codec tacked on for stuff recorded
// live in the browser, e.g. "audio/webm;codecs=opus" -- an exact-match
// allowlist would reject perfectly fine recordings just because of that
// suffix, so we strip the codec part and only check the base type
function fileFilter(req, file, cb) {
  const baseType = file.mimetype.split(';')[0].trim().toLowerCase();
  if (baseType.startsWith('audio/') || baseType.startsWith('video/')) {
    cb(null, true);
  } else {
    // plain Error isn't a multer.MulterError, so errorHandler's generic branch
    // would default this to 500 without an explicit status -- it's a bad
    // request, not a server failure
    const err = new Error(`unsupported file type: ${file.mimetype}. please upload an audio or video file`);
    err.status = 400;
    cb(err);
  }
}

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 100;

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxUploadMb * 1024 * 1024 },
});
