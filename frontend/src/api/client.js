// tiny wrapper around fetch so the components don't have to deal with
// json headers / error handling every single time

const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers:
      options.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
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
