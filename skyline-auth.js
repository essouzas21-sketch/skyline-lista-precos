/**
 * Autenticação da Lista de Preços Skyline.
 * Sessão em sessionStorage; usuários extras em localStorage; admin seed no código (hash).
 * Chaves próprias — não compartilha login com o dashboard de produção.
 */
const SkylineAuth = (() => {
  const USERS_KEY = "skyline_precos_users_v1";
  const SESSION_KEY = "skyline_precos_session_v1";
  const LOGIN_PAGE = "index.html";
  const PUBLIC_PAGES = new Set(["index.html", "login.html"]);

  /** Admin inicial — senha só em hash (SHA-256 de salt+senha). */
  const SEED_USERS = [
    {
      email: "ewerton.santos@gruposkytech.com.br",
      name: "Ewerton Santos",
      role: "admin",
      salt: "skyline-seed-v1",
      hash: "5fd62aeb6b1e227636e90f7b545445cab20fc45abc58f6caad9d1afedf7a0171",
      active: true,
      createdAt: "2026-08-20T00:00:00.000Z"
    },
    {
      email: "tv@gruposkytech.com.br",
      name: "TV Skyline",
      role: "user",
      salt: "skyline-seed-tv-v1",
      hash: "c85b72f4eac01369360d99b71963a0fc96ae402fb94836ad61de48cb682284fb",
      active: true,
      createdAt: "2026-08-21T00:00:00.000Z"
    }
  ];

  function pageName() {
    const path = location.pathname || "";
    const base = path.split("/").pop() || "";
    return base.toLowerCase() || "index.html";
  }

  function isPublicPage() {
    return PUBLIC_PAGES.has(pageName());
  }

  function normEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(String(text));
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    return sha256Hex(`${salt}${password}`);
  }

  function readUsersRaw() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function ensureSeedUsers() {
    const users = readUsersRaw();
    let changed = false;
    SEED_USERS.forEach((seed) => {
      const email = normEmail(seed.email);
      if (users.some((u) => normEmail(u.email) === email)) return;
      users.push({ ...seed, email });
      changed = true;
    });
    if (changed) writeUsers(users);
    return users;
  }

  function listUsers() {
    return ensureSeedUsers()
      .map((u) => ({
        email: normEmail(u.email),
        name: String(u.name || "").trim() || normEmail(u.email),
        role: u.role === "admin" ? "admin" : "user",
        active: u.active !== false,
        createdAt: u.createdAt || null,
        updatedAt: u.updatedAt || null
      }))
      .sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
  }

  function findUserRecord(email) {
    const key = normEmail(email);
    return ensureSeedUsers().find((u) => normEmail(u.email) === key) || null;
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.email) return null;
      const user = findUserRecord(s.email);
      if (!user || user.active === false) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return {
        email: normEmail(user.email),
        name: String(user.name || "").trim() || normEmail(user.email),
        role: user.role === "admin" ? "admin" : "user",
        at: s.at || Date.now()
      };
    } catch {
      return null;
    }
  }

  function setSession(user) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        email: normEmail(user.email),
        name: user.name,
        role: user.role,
        at: Date.now()
      })
    );
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function login(email, password) {
    const user = findUserRecord(email);
    if (!user || user.active === false) {
      return { ok: false, error: "E-mail ou senha inválidos." };
    }
    const hash = await hashPassword(password, user.salt || "");
    if (hash !== user.hash) {
      return { ok: false, error: "E-mail ou senha inválidos." };
    }
    const session = {
      email: normEmail(user.email),
      name: String(user.name || "").trim() || normEmail(user.email),
      role: user.role === "admin" ? "admin" : "user"
    };
    setSession(session);
    return { ok: true, user: session };
  }

  function logout(redirectTo) {
    clearSession();
    location.href = redirectTo || LOGIN_PAGE;
  }

  async function upsertUser({ email, name, password, role, active }) {
    const session = getSession();
    if (!session || session.role !== "admin") {
      return { ok: false, error: "Apenas administradores podem gerenciar usuários." };
    }
    const key = normEmail(email);
    if (!key || !key.includes("@")) {
      return { ok: false, error: "Informe um e-mail válido." };
    }
    const users = ensureSeedUsers();
    const idx = users.findIndex((u) => normEmail(u.email) === key);
    const now = new Date().toISOString();
    const nextRole = role === "admin" ? "admin" : "user";
    const nextActive = active !== false;

    if (idx < 0) {
      if (!password || String(password).length < 6) {
        return { ok: false, error: "Senha obrigatória (mín. 6 caracteres) para novo usuário." };
      }
      const salt = randomSalt();
      const hash = await hashPassword(password, salt);
      users.push({
        email: key,
        name: String(name || "").trim() || key,
        role: nextRole,
        salt,
        hash,
        active: nextActive,
        createdAt: now,
        updatedAt: now
      });
    } else {
      const cur = users[idx];
      if (key === normEmail(session.email) && nextRole !== "admin") {
        return { ok: false, error: "Você não pode remover o próprio perfil de admin." };
      }
      if (key === normEmail(session.email) && !nextActive) {
        return { ok: false, error: "Você não pode desativar a própria conta." };
      }
      let salt = cur.salt;
      let hash = cur.hash;
      if (password && String(password).length) {
        if (String(password).length < 6) {
          return { ok: false, error: "Nova senha deve ter no mínimo 6 caracteres." };
        }
        salt = randomSalt();
        hash = await hashPassword(password, salt);
      }
      users[idx] = {
        ...cur,
        email: key,
        name: String(name || cur.name || "").trim() || key,
        role: nextRole,
        salt,
        hash,
        active: nextActive,
        updatedAt: now
      };
    }
    writeUsers(users);
    return { ok: true };
  }

  function removeUser(email) {
    const session = getSession();
    if (!session || session.role !== "admin") {
      return { ok: false, error: "Apenas administradores podem gerenciar usuários." };
    }
    const key = normEmail(email);
    if (key === normEmail(session.email)) {
      return { ok: false, error: "Você não pode excluir a própria conta." };
    }
    if (key === normEmail("ewerton.santos@gruposkytech.com.br")) {
      return { ok: false, error: "A conta admin principal não pode ser excluída." };
    }
    const users = ensureSeedUsers().filter((u) => normEmail(u.email) !== key);
    writeUsers(users);
    return { ok: true };
  }

  function requireAuth() {
    if (isPublicPage()) return getSession();
    ensureSeedUsers();
    const session = getSession();
    if (session) return session;
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search + location.hash);
    location.replace(`${LOGIN_PAGE}?next=${next}`);
    return null;
  }

  function boot() {
    ensureSeedUsers();
    if (!isPublicPage()) requireAuth();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return {
    listUsers,
    login,
    logout,
    getSession,
    requireAuth,
    upsertUser,
    removeUser,
    normEmail,
    isPublicPage
  };
})();
