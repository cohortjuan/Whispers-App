// tiny wrapper around fetch so the components don't have to deal with
// json headers / error handling every single time

// Relative in prod on purpose -- vercel.json rewrites /api/* and /uploads/*
// to the Render backend, so the browser only ever talks to whispers-app's
// own origin. That's not just tidiness: whispers_csrf must be readable via
// document.cookie (that's the whole double-submit mechanism), and a cookie
// set by a *different* registrable domain (onrender.com) is invisible to
// JS running on this one no matter what SameSite/Secure say -- there's no
// cookie attribute that fixes that, only same-origin does. Hitting the
// Render URL directly from the browser was exactly that bug: sessions
// worked (the browser still attaches the cookie to requests), but every
// mutating request 403'd with "invalid or missing csrf token" because the
// frontend could never read the token to echo back.
const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "/api" : "http://localhost:5000/api")
).replace(/\/$/, "");

// The session itself lives in an httpOnly cookie (whispers_session) the
// backend sets on login — JS can't read it, and that's the point (closes off
// token theft via XSS). whispers_csrf is deliberately the readable one.
const CSRF_COOKIE = "whispers_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name) {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    ...(options.body instanceof FormData
      ? undefined
      : { "Content-Type": "application/json" }),
  };

  // The CSRF cookie is deliberately NOT httpOnly (unlike the session cookie)
  // specifically so this can read it and echo it back — that's the whole
  // double-submit mechanism. Only needed on requests that change state; GETs
  // don't carry a body to forge in the first place.
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie(CSRF_COOKIE);
    if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  }

  const res = await fetch(`${API_URL}${path}`, {
    // Cross-site by design (Vercel frontend, Render backend, different
    // domains) -- without this the browser never attaches the session
    // cookie at all and every authenticated request 401s.
    credentials: "include",
    headers,
    ...options,
  });

  // 204 No Content has nothing to parse
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `request failed with status ${res.status}`);
  }

  return data;
}

// builds a playable/downloadable url for a clip's audio/video file, or a
// person's uploaded photo. Passes an already-absolute URL through unchanged
// -- a person's photo_url can still be a plain external link someone typed
// in (the field predates upload support and both are allowed), and that
// case must not get "/uploads/" prepended in front of it.
export function getFileUrl(filePath) {
  if (!filePath) return filePath;
  if (/^https?:\/\//i.test(filePath)) return filePath;
  const base = API_URL.replace(/\/api\/?$/, "");
  return `${base}/uploads/${filePath}`;
}

// GET /api/people/:id/export -- a zip stream, not json, so it doesn't go
// through request(). Fetched and handed to the browser as a blob rather
// than being a plain <a href download>: in dev the API is on another origin
// (localhost:5000 vs :5173) and browsers ignore the `download` attribute
// cross-origin, so the old link opened the zip instead of saving it and
// lost the filename. Going through fetch keeps the behaviour identical in
// dev and prod, and credentials: "include" carries the session either way.
export async function downloadPersonExport(personId, filename) {
  const res = await fetch(`${API_URL}/people/${personId}/export`, {
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `export failed with status ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  auth: {
    me: () => request("/auth/me"),
    signup: (body) =>
      request("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
    login: (body) =>
      request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request("/auth/logout", { method: "POST" }),
    // body: { invite_code } -- moves the logged-in account into whichever
    // family issued that code
    joinFamily: (body) =>
      request("/auth/join-family", { method: "POST", body: JSON.stringify(body) }),
    // body: { email? } -- generates a fresh one-time code for the caller's
    // own family; omitting email makes it redeemable by whoever gets it first
    createInvite: (body) =>
      request("/auth/invites", { method: "POST", body: JSON.stringify(body) }),
    // soft-deletes the caller's own login (not their family's tree data),
    // 30-day grace period -- see POST /auth/restore to undo
    deleteAccount: () => request("/auth/me", { method: "DELETE" }),
    // body: { email, password } -- undoes deleteAccount within the grace
    // period. public (no session needed), re-verifies the password since
    // deleteAccount revokes every session immediately
    restoreAccount: (body) =>
      request("/auth/restore", { method: "POST", body: JSON.stringify(body) }),
    // how many active logins share the caller's family -- used to warn
    // before deleting the last one
    familyMemberCount: () => request("/auth/family-member-count"),
    // body: { name }
    updateFamily: (body) =>
      request("/auth/family", { method: "PATCH", body: JSON.stringify(body) }),
  },
  people: {
    list: () => request("/people"),
    get: (id) => request(`/people/${id}`),
    // trashed (soft-deleted) people in the caller's family
    listTrash: () => request("/people/trash"),
    // pulls a person back out of the trash, within the 30-day window
    restore: (id) => request(`/people/${id}/restore`, { method: "POST" }),
    // "delete forever now" -- only works on someone already in the trash
    purge: (id) => request(`/people/${id}/permanent`, { method: "DELETE" }),
    // body can be a plain object (JSON, no photo change) or a FormData
    // (includes a "photo" file field) -- request() already branches on
    // that for the Content-Type header, this just avoids double-encoding
    // a FormData body by JSON.stringify-ing it.
    create: (body) =>
      request("/people", {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    update: (id, body) =>
      request(`/people/${id}`, {
        method: "PUT",
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    remove: (id) => request(`/people/${id}`, { method: "DELETE" }),
  },
  relationships: {
    list: (personId) =>
      request(
        personId ? `/relationships?person_id=${personId}` : "/relationships",
      ),
    create: (body) =>
      request("/relationships", { method: "POST", body: JSON.stringify(body) }),
    remove: (id) => request(`/relationships/${id}`, { method: "DELETE" }),
  },
  clips: {
    list: (personId) =>
      request(personId ? `/clips?person_id=${personId}` : "/clips"),
    get: (id) => request(`/clips/${id}`),
    // formData needs to include: file, person_id, title, description, recorded_date, media_type
    create: (formData) => request("/clips", { method: "POST", body: formData }),
    update: (id, body) =>
      request(`/clips/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    // moves the clip to the trash (recoverable for TRASH_RETENTION_DAYS),
    // it is not destroyed here -- see restore/purge below
    remove: (id) => request(`/clips/${id}`, { method: "DELETE" }),
    listTrash: () => request("/clips/trash"),
    restore: (id) => request(`/clips/${id}/restore`, { method: "POST" }),
    purge: (id) => request(`/clips/${id}/permanent`, { method: "DELETE" }),
  },
};
