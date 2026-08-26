import { pool } from '../db/pool.js';

// requireAuth (must run before this) only proves "logged in", not "this is
// your family's file" -- a person's photo and a clip's audio/video are the
// most private content this app stores, more so than the API responses
// about them. This checks the filename in the /uploads URL against both
// places a family-scoped filename can live (clips.file_path,
// people.photo_url) before express.static ever gets to serve it, so a
// member of one family can't stream/view another family's upload even if
// they somehow got hold of (or guessed) the filename.
export async function requireFileAccess(req, res, next) {
  try {
    // req.path is everything after the "/uploads" mount point -- just the
    // bare filename multer generated. Reject anything with a path separator
    // outright rather than let it anywhere near a query; a legit filename
    // from upload.js/photoUpload never contains one.
    const filename = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return res.status(404).json({ error: 'file not found' });
    }

    const result = await pool.query(
      `SELECT 1
       FROM clips c JOIN people p ON p.id = c.person_id
       WHERE c.file_path = $1 AND p.family_id = $2
       UNION ALL
       SELECT 1 FROM people p WHERE p.photo_url = $1 AND p.family_id = $2
       LIMIT 1`,
      [filename, req.user.family.id]
    );

    // same 404 whether the file doesn't exist at all or just belongs to a
    // different family -- doesn't confirm to the caller which is true
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'file not found' });
    }

    next();
  } catch (err) {
    next(err);
  }
}
