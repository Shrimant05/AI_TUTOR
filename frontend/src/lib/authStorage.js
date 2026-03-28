const AUTH_KEYS = ["token", "role", "username"];
const AUTH_BASE_URL = "http://localhost:8000";

function parseJwtPayload(token) {
  try {
    const parts = (token || "").split(".");
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clearLegacyCookie(name) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export function saveAuthSession({ token, role, username }) {
  if (typeof window === "undefined") return;

  const session = {
    token: token || "",
    role: role || "",
    username: username || "",
  };

  AUTH_KEYS.forEach((key) => {
    sessionStorage.setItem(key, session[key]);
    localStorage.removeItem(key); // clear legacy local persistence
    clearLegacyCookie(key); // clear legacy cookie persistence
  });
}

export function loadAuthSession() {
  if (typeof window === "undefined") {
    return { token: "", role: "", username: "" };
  }

  let token = sessionStorage.getItem("token") || "";
  let role = sessionStorage.getItem("role") || "";
  let username = sessionStorage.getItem("username") || "";

  // Clear any legacy persisted login info from previous implementations.
  AUTH_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    clearLegacyCookie(key);
  });

  // Always trust the token payload role over stored role to avoid stale role switches.
  const payload = parseJwtPayload(token);
  if (payload && typeof payload.role === "string") {
    role = payload.role;
    sessionStorage.setItem("role", role);
  }

  return { token, role, username };
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  AUTH_KEYS.forEach((key) => {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
    clearLegacyCookie(key);
  });
}

export async function syncAuthSessionWithServer(token) {
  if (!token) return null;

  try {
    const response = await fetch(`${AUTH_BASE_URL}/api/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const profile = await response.json();
    const session = {
      token,
      role: profile.role || "",
      username: profile.username || "",
    };
    saveAuthSession(session);
    return session;
  } catch {
    return null;
  }
}
