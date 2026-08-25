// tiny wrapper around fetch so the components don't have to deal with
// json headers / error handling every single time

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? "https://whispers-app.onrender.com/api"
    : "http://localhost:5000/api")
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

// builds a playable/downloadable url for a clip's audio/video file
export function getFileUrl(filePath) {
  const base = API_URL.replace(/\/api\/?$/, "");
  return `${base}/uploads/${filePath}`;
}

export const api = {
  auth: {
    me: () => request("/auth/me"),
    signup: (body) =>
      request("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
    login: (body) =>
      request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    logout: () => request("/auth/logout", { method: "POST" }),
  },
  people: {
    list: () => request("/people"),
    get: (id) => request(`/people/${id}`),
    create: (body) =>
      request("/people", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) =>
      request(`/people/${id}`, { method: "PUT", body: JSON.stringify(body) }),
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
    remove: (id) => request(`/clips/${id}`, { method: "DELETE" }),
  },
};
