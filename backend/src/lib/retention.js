// The one place the trash/account-deletion grace period is defined.
//
// It used to live in three places at once -- jobs/purge.js and
// routes/people.js each declared their own TRASH_RETENTION_DAYS, and
// routes/auth.js inlined it a fourth time as `30 * 24 * 60 * 60 * 1000`.
// Nothing kept them in step, so changing one silently desynchronised the
// rest: drop the purge job to 14 days and people.js would still offer
// "restore" for 30 on rows the job had already hard-deleted, while the UI
// went on promising 30 either way.
//
// The frontend has its own copy for display copy only (see
// TRASH_RETENTION_DAYS in frontend/src/utils.js) -- it can't import from
// the backend, and the API returns real timestamps (purge_at) for anything
// that has to be exact.
export const TRASH_RETENTION_DAYS = 30;

export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
