import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// UPLOAD_DIR_PATH lets production point this at a mounted persistent disk
// (e.g. Render's disks feature) instead of the backend's own source
// checkout, which gets wiped on every redeploy since it's ephemeral there.
// Local dev has no such disk, so it just falls back to backend/uploads.
export const UPLOAD_DIR = process.env.UPLOAD_DIR_PATH || path.join(__dirname, '..', '..', 'uploads');

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

// ---------------------------------------------------------------------
// A second, stricter upload config for person avatars.
//
// The audio/video filter above trusts whatever mimetype the browser
// reports, which is fine for clips (recorded in-browser or picked from
// a file dialog, low stakes either way). A photo is a much more common
// target for someone to deliberately mislabel, so this checks the
// actual file bytes (a "magic number" every real image format starts
// with) instead of trusting the client's word for it -- a renamed
// script or executable with a faked Content-Type won't pass.
// ---------------------------------------------------------------------

const IMAGE_MAGIC_BYTES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: "RIFF" .... "WEBP" -- bytes 8-11 aren't part of the fixed
  // signature (they're the chunk size), so that gap is skipped below.
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], skip: 4, then: [0x57, 0x45, 0x42, 0x50] },
];

function matchesSignature(buffer, sig) {
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[i] !== sig.bytes[i]) return false;
  }
  if (sig.then) {
    const offset = sig.bytes.length + sig.skip;
    for (let i = 0; i < sig.then.length; i++) {
      if (buffer[offset + i] !== sig.then[i]) return false;
    }
  }
  return true;
}

export function isRealImage(buffer) {
  return IMAGE_MAGIC_BYTES.some((sig) => matchesSignature(buffer, sig));
}

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname) || '';
    cb(null, `avatar-${Date.now()}-${uniqueSuffix}${ext}`);
  },
});

// The mimetype check here is just a fast, cheap first pass to reject
// obviously-wrong uploads before spending disk I/O -- isRealImage() on
// the actual saved bytes (done in the route handler, after multer
// writes the file) is the real gate, since mimetype alone is only what
// the client claims.
function photoFileFilter(req, file, cb) {
  const baseType = file.mimetype.split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].includes(baseType)) {
    cb(null, true);
  } else {
    const err = new Error(`unsupported photo type: ${file.mimetype}. please upload a JPEG, PNG, or WebP image`);
    err.status = 400;
    cb(err);
  }
}

// A profile photo has no business being anywhere near the 100MB clip
// cap -- 5MB is generous for a single portrait-style image and keeps a
// mistaken upload (or someone testing the limits) cheap to store.
const MAX_PHOTO_MB = 5;

export const photoUpload = multer({
  storage: photoStorage,
  fileFilter: photoFileFilter,
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024 },
});
