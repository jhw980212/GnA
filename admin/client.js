const SESSION_KEY = "galab-cms-session-v1";
const PASSWORD_FLOW_KEY = "galab-cms-password-flow-v1";

export function validateConfig(config) {
  if (!config?.supabaseUrl || !config?.publishableKey) return false;
  try {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return false;
    if (url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) return false;
    const key = config.publishableKey;
    if (typeof key !== "string" || key.startsWith("sb_secret_")) return false;
    if (key.startsWith("eyJ")) {
      const claims = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (claims.role !== "anon") return false;
    } else if (!key.startsWith("sb_publishable_")) return false;
    if (config.loginAccounts !== undefined) {
      const accounts = config.loginAccounts;
      if (!accounts || typeof accounts !== "object" || Array.isArray(accounts) || Object.keys(accounts).length > 20) return false;
      if (!Object.entries(accounts).every(([id, email]) => /^[a-z][a-z0-9_-]{0,31}$/.test(id)
        && typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return false;
    }
    return /^[a-z][a-z0-9-]*$/.test(config.functionName || "cms-api");
  } catch { return false; }
}

export function createClient(config, dependencies = {}) {
  if (!validateConfig(config)) throw new Error("관리자 서비스 연결 설정을 확인해 주세요.");
  const browser = dependencies.window || window;
  const fetcher = dependencies.fetch || fetch;
  const store = dependencies.storage || browser.sessionStorage;
  const base = config.supabaseUrl.replace(/\/$/, "");
  const functionName = config.functionName || "cms-api";
  let session = null;
  let refreshing = null;
  let passwordFlow = false;
  try {
    session = JSON.parse(store.getItem(SESSION_KEY) || "null");
    passwordFlow = store.getItem(PASSWORD_FLOW_KEY) === "1";
  } catch { /* Storage can be unavailable on restricted browsers. */ }

  function remember(value) {
    session = value;
    try {
      if (value) store.setItem(SESSION_KEY, JSON.stringify(value));
      else store.removeItem(SESSION_KEY);
    } catch { /* The session still works for the lifetime of the page. */ }
    return session;
  }

  function setPasswordFlow(value) {
    passwordFlow = value;
    try {
      if (value) store.setItem(PASSWORD_FLOW_KEY, "1");
      else store.removeItem(PASSWORD_FLOW_KEY);
    } catch { /* Memory state remains valid. */ }
  }

  const fragment = new URLSearchParams(browser.location.hash.replace(/^#/, ""));
  if (fragment.get("access_token") && fragment.get("refresh_token")) {
    remember({
      access_token: fragment.get("access_token"),
      refresh_token: fragment.get("refresh_token"),
      expires_at: Number(fragment.get("expires_at")) || Math.floor(Date.now() / 1000) + (Number(fragment.get("expires_in")) || 3600),
    });
    setPasswordFlow(["invite", "recovery"].includes(fragment.get("type")));
    browser.history.replaceState({}, "", browser.location.pathname + browser.location.search);
  } else if (fragment.get("error_description")) {
    browser.history.replaceState({}, "", browser.location.pathname + browser.location.search);
    throw new Error("초대 또는 비밀번호 재설정 링크가 만료되었습니다. 관리자에게 새 링크를 요청해 주세요.");
  }

  async function http(path, { method = "GET", body, token, timeout = 70000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(base + path, {
        method,
        headers: {
          apikey: config.publishableKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      let data;
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) {
        let message = data.message || data.error_description || (typeof data.error === "string" ? data.error : data.error?.message);
        if (path.startsWith("/auth/")) {
          message = response.status === 400 || response.status === 401
            ? "로그인 정보 또는 링크를 확인해 주세요."
            : response.status === 429 ? "요청이 많습니다. 잠시 후 다시 시도해 주세요."
            : "로그인 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        }
        const error = new Error(message || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        error.status = response.status;
        error.code = data.code || data.error;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("응답이 지연되고 있습니다. 반영 요청을 했다면 목록을 새로고침해서 상태를 먼저 확인해 주세요.");
      if (error instanceof TypeError) throw new Error("서비스에 연결할 수 없습니다. 인터넷 연결과 관리자 서비스 설정을 확인해 주세요.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  function tokenSession(data) {
    if (!data.access_token || !data.refresh_token) throw new Error("로그인 세션을 확인하지 못했습니다.");
    return remember({ ...data, expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600) });
  }

  async function refresh() {
    if (refreshing) return refreshing;
    if (!session?.refresh_token) return null;
    refreshing = (async () => {
      try {
        const data = await http("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, timeout: 25000 });
        return tokenSession(data);
      } catch (error) {
        if ([400, 401, 403].includes(error.status)) { remember(null); setPasswordFlow(false); }
        throw error;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }

  async function getSession() {
    if (!session?.access_token) return null;
    if (!session.expires_at || session.expires_at <= Math.floor(Date.now() / 1000) + 60) await refresh();
    return session;
  }

  async function currentUser() {
    const value = await getSession();
    if (!value) return null;
    const user = await http("/auth/v1/user", { token: value.access_token, timeout: 25000 });
    remember({ ...session, user });
    return user;
  }

  return {
    getSession,
    currentUser,
    isPasswordFlow: () => passwordFlow,
    async signIn(identifier, password) {
      const login = String(identifier || "").trim();
      const alias = login.toLowerCase();
      const accounts = config.loginAccounts || {};
      const email = login.includes("@") ? login : (Object.hasOwn(accounts, alias) ? accounts[alias] : "");
      if (!email) throw new Error("아이디 또는 비밀번호를 확인해 주세요.");
      setPasswordFlow(false);
      return tokenSession(await http("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, timeout: 25000 }));
    },
    async signOut() {
      const token = session?.access_token;
      remember(null);
      setPasswordFlow(false);
      if (token) {
        try { await http("/auth/v1/logout?scope=local", { method: "POST", token, timeout: 10000 }); } catch { /* Browser session has already been cleared. */ }
      }
    },
    async setPassword(password) {
      if (typeof password !== "string" || password.length < 12) throw new Error("비밀번호는 12자 이상으로 설정해 주세요.");
      const value = await getSession();
      if (!value) throw new Error("초대 또는 재설정 링크로 다시 접속해 주세요.");
      await http("/auth/v1/user", { method: "PUT", body: { password }, token: value.access_token, timeout: 25000 });
      setPasswordFlow(false);
    },
    async recoverPassword(email) {
      const redirect = new URL("./", browser.location.href).href.split("?")[0].split("#")[0];
      return http(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, { method: "POST", body: { email: email.trim() }, timeout: 25000 });
    },
    async request(action, payload = {}) {
      let value = await getSession();
      if (!value) throw new Error("다시 로그인해 주세요.");
      try {
        return await http(`/functions/v1/${functionName}`, { method: "POST", body: { action, payload }, token: value.access_token });
      } catch (error) {
        if (error.status !== 401) throw error;
        value = await refresh();
        if (!value) throw new Error("다시 로그인해 주세요.");
        return http(`/functions/v1/${functionName}`, { method: "POST", body: { action, payload }, token: value.access_token });
      }
    },
  };
}
