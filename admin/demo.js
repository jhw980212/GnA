// Explicit, local-only Blog workflow preview. It never authenticates real users
// or sends anything to Supabase, GitHub, or email.
const STORE_KEY = "galab-cms-demo-v2";
const LEGACY_STORE_KEY = "galab-cms-demo-v1";
const EDITOR = { id: "demo-editor", email: "writer@example.test", display_name: "연구실 구성원", role: "editor" };
const ADMIN = { id: "demo-admin", email: "admin@example.test", display_name: "관리자", role: "admin" };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const copy = value => JSON.parse(JSON.stringify(value));
const blogPath = path => typeof path === "string" && /^_blog\x2f[^/\\\x00-\x1f]+\.md$/.test(path);
const isBlogEntry = entry => entry?.collection === "blog" && (!entry.source_path || blogPath(entry.source_path));

export function createDemoClient() {
  let profile = EDITOR;
  let state;
  let loading;
  let persistAllowed = true;
  const stamp = () => new Date().toISOString();

  function storedState() {
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved?.entries) && Array.isArray(saved?.catalog)) return saved;
      persistAllowed = false;
      return null;
    } catch { persistAllowed = false; return null; }
  }
  function persist() {
    if (!persistAllowed) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* The demo remains usable in memory. */ }
  }
  async function load() {
    if (state) return;
    if (loading) return loading;
    loading = (async () => {
      state = storedState();
      if (Array.isArray(state?.entries) && Array.isArray(state?.catalog)) {
        // Preserve all earlier local records. Only Blog records are available
        // through this adapter; legacy records cannot be read or mutated by ID.
        state.schema = 3;
        persist();
        return;
      }
      const response = await fetch(new URL("demo-data.json", import.meta.url));
      if (!response.ok) throw new Error("체험 데이터를 불러오지 못했습니다.");
      const data = await response.json();
      state = {
        schema: 3,
        catalog: data.files.filter(file => file.collection === "blog" && blogPath(file.path)),
        entries: [
          { id: "demo-lab-story", author_id: EDITOR.id, collection: "blog", title: "함께한 연구실 세미나를 돌아보며", date: today(), description: "연구 진행 상황을 나누고 다음 활동을 함께 이야기했습니다.", body: "## 함께한 연구실 세미나\n\n이번 세미나에서는 연구 진행 상황을 공유하고 다음 활동을 함께 이야기했습니다.\n\n- 함께 나눈 연구 이야기\n- 세미나에서 배운 점\n- 다음 활동을 위한 준비", image_alt: "", image_caption: "", assets: [], status: "submitted", version: 1, feedback: "", created_at: stamp(), updated_at: stamp() },
          { id: "demo-lab-day", author_id: EDITOR.id, collection: "blog", title: "연구실의 하루를 기록합니다", date: today(), description: "사진과 짧은 글로 남기는 연구실의 하루", body: "오늘의 실험과 함께한 순간을 기록해 보세요.\n\n초안을 저장한 뒤 사진을 추가할 수 있습니다.", image_alt: "", image_caption: "", assets: [], status: "draft", version: 1, feedback: "", created_at: stamp(), updated_at: stamp() },
        ],
      };
      persist();
    })();
    try { await loading; } finally { loading = null; }
  }
  function requireAdmin() {
    if (profile.role !== "admin") throw new Error("관리자만 사용할 수 있습니다.");
  }
  function entryFor(id) {
    const entry = state.entries.find(value => value.id === id);
    if (!entry || !isBlogEntry(entry) || (profile.role !== "admin" && entry.author_id !== profile.id)) throw new Error("블로그 글을 찾을 수 없습니다.");
    return entry;
  }
  function versionCheck(entry, version) {
    if (entry.version !== Number(version)) throw new Error("글이 다른 화면에서 변경되었습니다. 목록을 새로고침해 주세요.");
  }
  function editable(entry) {
    if (!["draft", "changes_requested"].includes(entry.status)) throw new Error("제출한 글은 수정 요청을 받은 뒤에 수정할 수 있습니다.");
  }
  function changed(entry) {
    entry.version += 1;
    entry.updated_at = stamp();
    persist();
    return { entry: copy(entry) };
  }
  return {
    isDemo: true,
    isPasswordFlow: () => false,
    async getSession() { await load(); return { user: copy(profile), expires_at: Number.MAX_SAFE_INTEGER }; },
    async currentUser() { return copy(profile); },
    async setRole(role) { profile = role === "admin" ? ADMIN : EDITOR; },
    async signIn() { return { user: copy(profile) }; },
    async signOut() { profile = EDITOR; },
    async setPassword() { throw new Error("체험 모드에는 실제 계정이 없습니다."); },
    async recoverPassword() { throw new Error("체험 모드에서는 메일을 보내지 않습니다."); },
    async request(action, payload = {}) {
      await load();
      if (action === "profile") return { profile: copy(profile) };
      if (action === "list") return { entries: copy(state.entries.filter(entry => isBlogEntry(entry) && (profile.role === "admin" || entry.author_id === profile.id))), profile: copy(profile) };
      if (action === "catalog") {
        requireAdmin();
        return { files: copy(state.catalog.filter(file => file.collection === "blog" && blogPath(file.path))) };
      }
      if (action === "import") {
        requireAdmin();
        if (payload.id) entryFor(payload.id);
        if (!blogPath(payload.path)) throw new Error("블로그 글을 찾을 수 없습니다.");
        const source = state.catalog.find(file => file.collection === "blog" && file.path === payload.path);
        if (!source) throw new Error("블로그 글을 찾을 수 없습니다.");
        const existing = state.entries.find(entry => isBlogEntry(entry) && entry.source_path === payload.path && entry.status !== "published");
        if (existing) {
          if (payload.refresh === true) {
            if (payload.id !== existing.id) throw new Error("최신 글 정보를 확인해 주세요.");
            versionCheck(existing, payload.version);
            if (!["draft", "submitted", "changes_requested"].includes(existing.status)) throw new Error("반영 중인 글은 최신 내용으로 대체할 수 없습니다.");
            for (const key of ["title", "date", "body", "description", "image_alt", "image_caption"]) existing[key] = source[key] || "";
            existing.frontmatter = copy(source.frontmatter || {});
            existing.image = source.image || "";
            existing.status = "draft";
            existing.feedback = "";
            return { ...changed(existing), refreshed: true };
          }
          return { entry: copy(existing) };
        }
        const entry = { ...copy(source), collection: "blog", id: crypto.randomUUID(), author_id: profile.id, source_path: source.path, assets: [], status: "draft", version: 1, feedback: "", image_alt: source.image_alt || "", image_caption: source.image_caption || "", created_at: stamp(), updated_at: stamp() };
        state.entries.unshift(entry);
        persist();
        return { entry: copy(entry) };
      }
      if (action === "save") {
        const input = payload.entry || {};
        if (input.collection !== "blog" || !input.title?.trim() || input.title.length > 200) throw new Error("블로그 제목을 200자 이하로 입력해 주세요.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || "") || input.date > today()) throw new Error("날짜는 오늘 또는 이전 날짜로 설정해 주세요.");
        let entry;
        if (input.id) {
          entry = entryFor(input.id);
          versionCheck(entry, payload.version);
          editable(entry);
        } else entry = { id: crypto.randomUUID(), author_id: profile.id, collection: "blog", status: "draft", version: 0, feedback: "", assets: [], created_at: stamp() };
        let savedAssets = entry.assets || [];
        if (Array.isArray(input.assets)) {
          if (input.assets.length > 10 || new Set(input.assets.map(asset => asset.path)).size !== input.assets.length) throw new Error("사진 목록을 확인해 주세요.");
          savedAssets = input.assets.map(asset => {
            const known = (entry.assets || []).find(value => value.path === asset.path);
            if (!known) throw new Error("사진 목록을 새로고침해 주세요.");
            return { ...known, caption: asset.caption || "", alt: asset.alt || "" };
          });
        }
        for (const key of ["title", "date", "body", "description", "image_alt", "image_caption"]) entry[key] = input[key] || "";
        entry.assets = savedAssets;
        entry.status = "draft";
        if (!input.id) state.entries.unshift(entry);
        return changed(entry);
      }
      if (!["assets", "upload", "submit", "reject", "approve"].includes(action)) throw new Error("지원하지 않는 요청입니다.");
      const entry = entryFor(payload.id);
      if (action === "assets") return { assets: copy(entry.assets || []) };
      versionCheck(entry, payload.version);
      if (action === "upload") {
        editable(entry);
        const encoded = String(payload.base64 || "");
        const size = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
        if (!/^image\x2f(jpeg|png|webp)$/.test(payload.mime) || !encoded || size > 5 * 1024 * 1024) throw new Error("5 MB 이하의 JPG, PNG, WebP 사진만 추가할 수 있습니다.");
        if ((entry.assets || []).length >= 10) throw new Error("사진은 최대 10장까지 추가할 수 있습니다.");
        const asset = { path: entry.author_id + "/" + entry.id + "/" + crypto.randomUUID(), name: payload.name, mime: payload.mime, size, caption: "", alt: "", url: "data:" + payload.mime + ";base64," + encoded };
        entry.assets ||= [];
        entry.assets.push(asset);
        return { ...changed(entry), asset: copy(asset) };
      }
      if (action === "submit") {
        editable(entry);
        entry.status = "submitted";
        entry.feedback = "";
        return changed(entry);
      }
      if (action === "reject") {
        requireAdmin();
        if (entry.status !== "submitted" || !payload.feedback?.trim()) throw new Error("검토할 글과 수정 의견을 확인해 주세요.");
        entry.status = "changes_requested";
        entry.feedback = payload.feedback.trim();
        return changed(entry);
      }
      requireAdmin();
      if (entry.status !== "submitted") throw new Error("제출한 글만 반영할 수 있습니다.");
      entry.status = "published";
      entry.published_at = stamp();
      const path = entry.source_path || "_blog/" + entry.date + "-cms-" + entry.id + ".md";
      const image = entry.assets?.[0]?.url || entry.image || entry.frontmatter?.image || "";
      const frontmatter = { ...(entry.frontmatter || {}), image };
      if (entry.assets?.length) frontmatter.gallery = entry.assets.slice(1).map(asset => ({ image: asset.url, alt: asset.alt, caption: asset.caption }));
      const file = { ...copy(entry), image, frontmatter, path, collection: "blog", sha: "demo-only" };
      const index = state.catalog.findIndex(source => source.collection === "blog" && source.path === path);
      if (index >= 0) state.catalog[index] = file;
      else state.catalog.push(file);
      entry.source_path = path;
      return { ...changed(entry), commitCreated: false, deployment: "demo" };
    },
  };
}
