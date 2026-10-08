import { COLLECTIONS, assetRepoPath, collectionPath } from "./content-types.js";

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_REQUEST = 8 * 1024 * 1024;
const BUCKET = "cms-assets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = new Set(["draft", "changes_requested"]);
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const pathEncode = value => value.split("/").map(encodeURIComponent).join("/");
const publicEntry = entry => {
  const { publishing_token, pending_commit_sha, ...safe } = entry;
  return safe;
};
const encode64 = bytes => {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
};
const decode64 = value => {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    fail(400, "invalid_image", "이미지 데이터 형식이 올바르지 않습니다.");
  try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  catch { fail(400, "invalid_image", "이미지 데이터 형식이 올바르지 않습니다."); }
};
const decodeText = value => new TextDecoder().decode(decode64(value.replace(/\s/g, "")));
const safeText = (value, label, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    fail(400, "invalid_content", `${label}을(를) 확인해 주세요.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /[<>]|\{[{%]|[%}]\}/.test(value))
    fail(400, "unsafe_content", `${label}에 HTML 또는 템플릿 코드는 사용할 수 없습니다.`);
  return value;
};
const safeBody = value => {
  safeText(value, "본문", 100000);
  // The public Jekyll site and /admin share an origin. Do not allow active HTML/Liquid.
  if (/\{:/.test(value) || /(?:javascript|vbscript|data)\s*:/i.test(value) || /&(?:#x?[0-9a-f]+|colon|Tab|NewLine);/i.test(value))
    fail(400, "unsafe_content", "본문에 실행 가능한 URL 또는 HTML 이스케이프는 사용할 수 없습니다.");
  const urls = [...value.matchAll(/\]\(\s*([^\s)]+)/g), ...value.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)];
  for (const match of urls) {
    let target = match[1].replace(/\\/g, "");
    try { target = decodeURIComponent(target); } catch { /* Invalid percent escapes are inert. */ }
    const scheme = target.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) fail(400, "unsafe_content", "링크는 HTTP, HTTPS, 이메일 주소만 사용할 수 있습니다.");
  }
  return value;
};
const validId = value => { if (typeof value !== "string" || !UUID.test(value)) fail(400, "invalid_id", "글 ID가 올바르지 않습니다."); return value; };
const validVersion = value => { if (!Number.isSafeInteger(value) || value < 1) fail(400, "version_required", "최신 글 버전이 필요합니다. 목록을 새로고침해 주세요."); return value; };

export function renderEntryMarkdown(entry) {
  if (entry.collection !== "blog") fail(400, "invalid_collection", "CMS에서는 Blog 글과 사진만 관리할 수 있습니다.");
  const front = { ...entry.frontmatter, title: entry.title, date: entry.date, published: true };
  if (entry.description || "description" in front) front.description = entry.description;
  if (entry.assets.length) {
    front.image = assetRepoPath(entry, entry.assets[0]);
    front.image_alt = entry.image_alt || entry.assets[0].alt || entry.title;
    front.image_caption = entry.image_caption || entry.assets[0].caption || "";
    front.gallery = entry.assets.slice(1).map(asset => ({ image: assetRepoPath(entry, asset), alt: asset.alt || entry.title, caption: asset.caption || "" }));
  } else {
    if (entry.image_alt || "image_alt" in front) front.image_alt = entry.image_alt;
    if (entry.image_caption || "image_caption" in front) front.image_caption = entry.image_caption;
  }
  front.cms_entry_id = entry.id;
  front.cms_publish_version = entry.version;
  // JSON scalar/array/object values are valid YAML and avoid multiline quoting surprises.
  const yaml = Object.entries(front).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join("\n");
  return `---\n${yaml}\n---\n\n${entry.body.trim()}\n`;
}

export function createHandler(env, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const uuid = dependencies.uuid || (() => crypto.randomUUID());
  const now = dependencies.now || (() => new Date());
  const parseYaml = dependencies.parseYaml;
  const sb = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const repo = env.GITHUB_REPOSITORY || "exphysio/GnA";
  const branch = env.GITHUB_BRANCH || "main";
  let origin = "";
  try { origin = new URL(env.CMS_ORIGIN).origin; } catch { /* Configuration failure is reported below. */ }
  const adminUrl = env.CMS_ADMIN_URL || `${origin}/admin/`;

  const instant = () => now().toISOString();
  const today = () => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now());
    const part = type => parts.find(value => value.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const dateValue = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      fail(400, "invalid_date", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
    if (value > today()) fail(400, "future_date", "게시 날짜는 오늘(한국 시간) 이후로 설정할 수 없습니다.");
    return value;
  };

  async function sbRequest(path, options = {}) {
    const response = await fetcher(`${sb}${path}`, {
      ...options, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...options.headers },
    });
    if (!response.ok) {
      if (response.status === 409) fail(409, "conflict", "같은 글이 이미 작업 중입니다. 목록을 새로고침해 주세요.");
      fail(502, "storage_error", "CMS 저장소 요청에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    return response;
  }
  async function db(table, query = "", method = "GET", value) {
    const response = await sbRequest(`/rest/v1/${table}${query ? `?${query}` : ""}`, {
      method, headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    return response.status === 204 ? [] : response.json();
  }
  async function loadEntry(id, profile) {
    const [entry] = await db("cms_entries", `id=eq.${validId(id)}&collection=eq.blog&limit=1`);
    if (!entry || entry.collection !== "blog" || (entry.author_id !== profile.id && profile.role !== "admin")) fail(404, "not_found", "Blog 글을 찾을 수 없습니다.");
    if (entry.source_path && !collectionPath(entry.source_path)) fail(403, "outside_cms_scope", "CMS에서는 Blog 글과 사진만 관리할 수 있습니다.");
    return entry;
  }
  const requireAdmin = profile => { if (profile.role !== "admin") fail(403, "admin_required", "관리자만 사용할 수 있습니다."); };
  const checkVersion = (entry, version) => { if (entry.version !== validVersion(version)) fail(409, "version_conflict", "다른 작업에서 글이 변경되었습니다. 목록을 새로고침해 주세요."); };
  async function updateEntry(entry, patch, extraFilter = "") {
    const [updated] = await db("cms_entries", `id=eq.${entry.id}&version=eq.${entry.version}${extraFilter}`, "PATCH", { ...patch, updated_at: instant(), version: entry.version + 1 });
    if (!updated) fail(409, "version_conflict", "다른 작업에서 글이 변경되었습니다. 목록을 새로고침해 주세요.");
    return updated;
  }
  async function patchLease(entry, patch) {
    const [updated] = await db("cms_entries", `id=eq.${entry.id}&version=eq.${entry.version}&status=eq.publishing&publishing_token=eq.${entry.publishing_token}`, "PATCH", { ...patch, updated_at: instant() });
    if (!updated) fail(409, "publish_lock", "게시 작업 잠금이 변경되었습니다. 목록을 새로고침해 주세요.");
    return updated;
  }
  function contentFields(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "invalid_content", "글 정보가 필요합니다.");
    if (!COLLECTIONS.includes(input.collection)) fail(400, "invalid_collection", "CMS에서는 Blog 글과 사진만 관리할 수 있습니다.");
    const date = input.date || today();
    return {
      collection: "blog", title: safeText(input.title, "제목", 500, true).trim(), date: dateValue(date), details: {},
      body: safeBody(input.body ?? ""), description: safeText(input.description ?? "", "요약", 500),
      image_alt: safeText(input.image_alt ?? "", "대표 사진 설명", 300), image_caption: safeText(input.image_caption ?? "", "대표 사진 캡션", 500),
    };
  }
  async function git(path, method = "GET", body, allow404 = false) {
    const response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const conflict = response.status === 422 || response.status === 409;
      const error = new ApiError(conflict ? 409 : 502, conflict ? "github_conflict" : "github_error", conflict ? "GitHub에 다른 변경이 있습니다. 최신 내용을 확인하고 다시 시도해 주세요." : "GitHub 연결에 실패했습니다. 관리자에게 연결 설정 확인을 요청해 주세요.");
      error.upstreamStatus = response.status;
      throw error;
    }
    return response.json();
  }
  async function gitFile(path, ref) {
    const file = await git(`/contents/${pathEncode(path)}?ref=${encodeURIComponent(ref)}`, "GET", undefined, true);
    // Read omitted inline bytes from the immutable blob, without following a download URL.
    if (file?.type === "file" && file.size > 0 && file.size <= 1500000 && (!file.content || file.encoding === "none")) {
      const blob = await git(`/git/blobs/${encodeURIComponent(file.sha)}`);
      if (blob.encoding === "base64" && typeof blob.content === "string") return { ...file, content: blob.content, encoding: blob.encoding };
    }
    return file;
  }
  async function signedAssets(entry) {
    return Promise.all(entry.assets.map(async asset => {
      const response = await sbRequest(`/storage/v1/object/sign/${BUCKET}/${pathEncode(asset.path)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }),
      });
      const result = await response.json();
      const signed = result.signedURL || result.signedUrl;
      if (typeof signed !== "string") fail(502, "storage_error", "사진 미리보기를 불러오지 못했습니다.");
      return { ...asset, url: signed.startsWith("http") ? signed : `${sb}/storage/v1${signed}` };
    }));
  }
  function parseDocument(text) {
    if (!parseYaml) fail(503, "parser_unavailable", "기존 글 가져오기 기능이 설정되지 않았습니다.");
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!match) fail(400, "invalid_document", "이 파일에는 올바른 Jekyll 머리말이 없습니다.");
    let frontmatter;
    try { frontmatter = parseYaml(match[1]); } catch { fail(400, "invalid_document", "기존 글의 YAML 머리말을 읽을 수 없습니다."); }
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) fail(400, "invalid_document", "YAML 머리말은 객체여야 합니다.");
    frontmatter = JSON.parse(JSON.stringify(frontmatter));
    if (Object.keys(frontmatter).some(key => ["__proto__", "constructor", "prototype"].includes(key))) fail(400, "invalid_document", "이 머리말은 가져올 수 없습니다.");
    return { frontmatter, body: match[2] };
  }
  async function markPublished(entry, commit) {
    const updated = await updateEntry(entry, {
      status: "published", commit_sha: commit.sha, commit_url: `https://github.com/${repo}/commit/${commit.sha}`,
      base_sha: commit.blobSha || entry.base_sha, published_at: instant(), publishing_started_at: null,
      publishing_token: null, pending_commit_sha: null, feedback: "",
    }, `&status=eq.publishing&publishing_token=eq.${entry.publishing_token}`);
    return { entry: publicEntry(updated), commitCreated: true, commitUrl: updated.commit_url, deployment: "queued" };
  }
  async function reconcile(entry) {
    if (!entry.pending_commit_sha) {
      if (now().getTime() - Date.parse(entry.publishing_started_at) > 15 * 60 * 1000) {
        await updateEntry(entry, { status: "submitted", publishing_token: null, publishing_started_at: null }, `&status=eq.publishing&publishing_token=eq.${entry.publishing_token}&pending_commit_sha=is.null`);
        fail(409, "publish_retry", "중단된 게시 작업을 복구했습니다. 목록을 새로고침한 뒤 다시 승인해 주세요.");
      }
      fail(409, "publishing", "게시 작업이 진행 중입니다. 잠시 뒤 목록을 새로고침해 주세요.");
    }
    const comparison = await git(`/compare/${encodeURIComponent(entry.pending_commit_sha)}...${encodeURIComponent(branch)}`);
    if (["ahead", "identical", "behind"].includes(comparison.status)) {
      const file = await gitFile(entry.source_path, entry.pending_commit_sha);
      const text = file?.content ? decodeText(file.content) : "";
      const record = parseDocument(text).frontmatter;
      if (record.cms_entry_id !== entry.id || record.cms_publish_version !== entry.version)
        fail(409, "publish_reconcile", "게시 기록을 자동 확인할 수 없습니다. 관리자 확인이 필요합니다.");
      // If the request never reached GitHub, apply the exact SAME commit. This is idempotent,
      // and a simultaneous unrelated update will cause GitHub's non-force ref update to reject.
      if (comparison.status === "behind") {
        try { await git(`/git/refs/heads/${pathEncode(branch)}`, "PATCH", { sha: entry.pending_commit_sha, force: false }); }
        catch { fail(503, "publishing_uncertain", "GitHub 반영 여부를 다시 확인해야 합니다. 잠시 뒤 다시 승인해 주세요."); }
      }
      return markPublished(entry, { sha: entry.pending_commit_sha, blobSha: file.sha });
    }
    if (comparison.status === "diverged") {
      await updateEntry(entry, { status: "submitted", publishing_token: null, publishing_started_at: null, pending_commit_sha: null }, `&status=eq.publishing&publishing_token=eq.${entry.publishing_token}`);
      fail(409, "publish_retry", "다른 GitHub 변경으로 게시가 중단되었습니다. 목록을 새로고침한 뒤 다시 승인해 주세요.");
    }
    fail(409, "publishing_uncertain", "GitHub 반영 여부를 확인 중입니다. 중복 게시를 막기 위해 잠시 뒤 다시 승인해 주세요.");
  }
  async function approve(input, profile) {
    requireAdmin(profile);
    let entry = await loadEntry(input.id, profile);
    if (entry.status === "published") return { entry: publicEntry(entry), commitCreated: false, commitUrl: entry.commit_url, deployment: "queued" };
    // A retry may carry the pre-lock version; reconcile only, never create a second commit.
    if (entry.status === "publishing") return reconcile(entry);
    checkVersion(entry, input.version);
    if (entry.status !== "submitted") fail(409, "invalid_state", "제출된 글만 승인할 수 있습니다.");
    contentFields(entry);
    let source = entry.source_path;
    if (!source) {
      const slug = entry.title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "post";
      source = `_blog/${entry.date}-${slug}-${entry.id.slice(0, 8)}.md`;
    }
    if (!collectionPath(source, entry.collection)) fail(400, "invalid_path", "게시 파일 경로가 올바르지 않습니다.");
    entry = await updateEntry(entry, { status: "publishing", source_path: source, source_key: null, publishing_token: uuid(), publishing_started_at: instant(), pending_commit_sha: null }, "&status=eq.submitted");
    let refAttempted = false;
    try {
      const assetItems = [];
      for (const asset of entry.assets) {
        const response = await sbRequest(`/storage/v1/object/${BUCKET}/${pathEncode(asset.path)}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== asset.size) fail(409, "asset_changed", "저장된 사진이 변경되었습니다. 관리자 확인이 필요합니다.");
        const blob = await git("/git/blobs", "POST", { content: encode64(bytes), encoding: "base64" });
        assetItems.push({ path: assetRepoPath(entry, asset), mode: "100644", type: "blob", sha: blob.sha });
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await git(`/git/ref/heads/${pathEncode(branch)}`);
        const current = await gitFile(source, head.object.sha);
        if ((entry.base_sha && current?.sha !== entry.base_sha) || (!entry.base_sha && current))
          fail(409, "source_changed", "이 글은 GitHub에서 수정되었습니다. 최신 글을 다시 가져와 검토해 주세요.");
        const document = renderEntryMarkdown(entry);
        const documentBytes = new TextEncoder().encode(document);
        const contentBlob = await git("/git/blobs", "POST", { content: encode64(documentBytes), encoding: "base64" });
        const treeItems = [{ path: source, mode: "100644", type: "blob", sha: contentBlob.sha }, ...assetItems];
        const parent = await git(`/git/commits/${head.object.sha}`);
        const tree = await git("/git/trees", "POST", { base_tree: parent.tree.sha, tree: treeItems });
        const commit = await git("/git/commits", "POST", {
          message: `CMS: ${entry.collection} ${entry.title}\n\nApproved-by: ${profile.email}\nCMS-entry: ${entry.id}`,
          tree: tree.sha, parents: [head.object.sha],
        });
        entry = await patchLease(entry, { pending_commit_sha: commit.sha });
        refAttempted = true;
        try {
          await git(`/git/refs/heads/${pathEncode(branch)}`, "PATCH", { sha: commit.sha, force: false });
        } catch (error) {
          if (error.code === "github_conflict") {
            refAttempted = false;
            entry = await patchLease(entry, { pending_commit_sha: null });
            if (attempt < 2) continue;
          }
          if (error.upstreamStatus >= 400 && error.upstreamStatus < 500 && ![408, 429].includes(error.upstreamStatus)) refAttempted = false;
          throw error;
        }
        return await markPublished(entry, { sha: commit.sha, blobSha: contentBlob.sha });
      }
      fail(409, "github_conflict", "GitHub 변경이 계속되고 있습니다. 잠시 뒤 다시 승인해 주세요.");
    } catch (error) {
      if (!refAttempted) {
        try { await updateEntry(entry, { status: "submitted", publishing_token: null, publishing_started_at: null, pending_commit_sha: null }, `&status=eq.publishing&publishing_token=eq.${entry.publishing_token}`); }
        catch { /* Leave the lease in place if storage is unavailable; reconciliation is safer. */ }
      } else {
        // A timeout or failed DB write after a ref update is ambiguous: keep the lock and recover by commit ancestry.
        fail(503, "publishing_uncertain", "GitHub 게시 결과를 확인 중입니다. 잠시 뒤 목록을 새로고침하고 다시 승인해 주세요.");
      }
      throw error;
    }
  }

  async function dispatch(action, input, profile) {
    if (action === "profile") return { profile };
    if (action === "list") {
      const filter = profile.role === "admin" ? "" : `&author_id=eq.${profile.id}`;
      const entries = await db("cms_entries", `collection=eq.blog&order=updated_at.desc&limit=500${filter}`);
      return { entries: entries.map(publicEntry), profile };
    }
    if (action === "save") {
      const fields = contentFields(input.entry);
      if (!input.entry.id) {
        if (input.entry.assets?.length) fail(400, "invalid_assets", "사진은 글을 저장한 뒤 업로드해 주세요.");
        const [entry] = await db("cms_entries", "", "POST", { id: uuid(), author_id: profile.id, ...fields, assets: [], frontmatter: {}, status: "draft", version: 1 });
        return { entry: publicEntry(entry) };
      }
      const entry = await loadEntry(input.entry.id, profile);
      checkVersion(entry, input.version);
      if (!EDITABLE.has(entry.status)) fail(409, "invalid_state", "제출 또는 게시 중인 글은 수정할 수 없습니다.");
      if (entry.source_path && fields.collection !== entry.collection) fail(400, "immutable_collection", "기존 글의 분류는 변경할 수 없습니다.");
      let assets = entry.assets;
      if (input.entry.assets !== undefined) {
        if (!Array.isArray(input.entry.assets) || input.entry.assets.length > 10) fail(400, "invalid_assets", "사진 목록을 확인해 주세요.");
        const known = new Map(entry.assets.map(asset => [asset.path, asset]));
        const used = new Set();
        assets = input.entry.assets.map(item => {
          const original = known.get(item?.path);
          if (!original || used.has(item.path)) fail(400, "invalid_assets", "이 글에 업로드한 사진만 선택할 수 있습니다.");
          used.add(item.path);
          return { ...original, alt: safeText(item.alt ?? original.alt ?? "", "사진 설명", 300), caption: safeText(item.caption ?? original.caption ?? "", "사진 캡션", 500) };
        });
      }
      return { entry: publicEntry(await updateEntry(entry, { ...fields, assets })) };
    }
    if (action === "submit") {
      const entry = await loadEntry(input.id, profile);
      checkVersion(entry, input.version);
      if (!EDITABLE.has(entry.status)) fail(409, "invalid_state", "초안 또는 수정 요청된 글만 제출할 수 있습니다.");
      contentFields(entry);
      return { entry: publicEntry(await updateEntry(entry, { status: "submitted", feedback: "" })) };
    }
    if (action === "reject") {
      requireAdmin(profile);
      const entry = await loadEntry(input.id, profile);
      checkVersion(entry, input.version);
      if (entry.status !== "submitted") fail(409, "invalid_state", "제출된 글만 수정 요청할 수 있습니다.");
      return { entry: publicEntry(await updateEntry(entry, { status: "changes_requested", feedback: safeText(input.feedback, "수정 요청", 2000, true).trim() })) };
    }
    if (action === "approve") return approve(input, profile);
    if (action === "assets") return { assets: await signedAssets(await loadEntry(input.id, profile)) };
    if (action === "upload") {
      const entry = await loadEntry(input.id, profile);
      checkVersion(entry, input.version);
      if (!EDITABLE.has(entry.status)) fail(409, "invalid_state", "수정할 수 있는 글에만 사진을 업로드할 수 있습니다.");
      if (entry.assets.length >= 10) fail(400, "asset_limit", "사진은 글당 10장까지 업로드할 수 있습니다.");
      if (typeof input.mime !== "string" || !Object.hasOwn(TYPES, input.mime)) fail(400, "invalid_image", "JPG, PNG, WebP 사진만 사용할 수 있습니다.");
      if (typeof input.base64 !== "string" || input.base64.length > Math.ceil(MAX_IMAGE / 3) * 4) fail(413, "image_too_large", "사진은 한 장당 5MB까지 사용할 수 있습니다.");
      const bytes = decode64(input.base64);
      if (!bytes.length || bytes.length > MAX_IMAGE) fail(413, "image_too_large", "사진은 한 장당 5MB까지 사용할 수 있습니다.");
      const signature = input.mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : input.mime === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
        : new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
      if (!signature) fail(400, "invalid_image", "파일 내용이 선택한 이미지 형식과 일치하지 않습니다.");
      const name = safeText(input.name || `photo.${TYPES[input.mime]}`, "사진 파일명", 200).replace(/[/\\]/g, "_");
      const asset = { path: `${entry.author_id}/${entry.id}/${uuid()}.${TYPES[input.mime]}`, name, mime: input.mime, size: bytes.length, alt: "", caption: "" };
      await sbRequest(`/storage/v1/object/${BUCKET}/${pathEncode(asset.path)}`, { method: "POST", headers: { "Content-Type": input.mime, "x-upsert": "false" }, body: bytes });
      try {
        const updated = await updateEntry(entry, { assets: [...entry.assets, asset] });
        return { entry: publicEntry(updated), asset };
      } catch (error) {
        try { await sbRequest(`/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [asset.path] }) }); } catch { /* Orphan cleanup is safe and can be done later. */ }
        throw error;
      }
    }
    if (action === "invite") {
      requireAdmin(profile);
      if (typeof input.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) fail(400, "invalid_email", "이메일 주소를 확인해 주세요.");
      const display_name = safeText(input.display_name || "", "이름", 100);
      const response = await sbRequest(`/auth/v1/invite?redirect_to=${encodeURIComponent(adminUrl)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: input.email.trim(), data: { display_name } }),
      });
      const result = await response.json();
      const id = result.id || result.user?.id;
      if (id) await db("cms_profiles", `id=eq.${id}`, "PATCH", { display_name, active: true });
      return { invited: true, email: input.email.trim() };
    }
    if (action === "catalog") {
      requireAdmin(profile);
      const directory = await gitFile("_blog", branch);
      if (directory !== null && !Array.isArray(directory)) fail(502, "github_error", "GitHub Blog 목록을 읽을 수 없습니다.");
      const files = (directory || []).filter(file => file.type === "file" && collectionPath(file.path)).map(file => {
        const filename = file.path.split("/").at(-1);
        return { path: file.path, source_key: null, collection: "blog", title: filename.replace(/\.md$/, ""), date: filename.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "", sha: file.sha };
      });
      const selected = files.slice(0, 200);
      let position = 0;
      // A small pool avoids a burst of hundreds of GitHub requests in larger archives.
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
        for (;;) {
          const index = position++; if (index >= selected.length) return;
          const summary = selected[index];
          const file = await gitFile(summary.path, branch);
          if (!file?.content || file.size > 300000) continue;
          try {
            const { frontmatter } = parseDocument(decodeText(file.content));
            if (typeof frontmatter.title === "string" && frontmatter.title.trim()) summary.title = frontmatter.title;
            if (frontmatter.date) summary.date = String(frontmatter.date).slice(0, 10);
            if (frontmatter.image) summary.image = frontmatter.image;
          } catch (error) {
            if (error.code !== "invalid_document") throw error;
            // A manually authored malformed file remains visible by filename, but cannot be imported.
          }
        }
      }));
      return { files: selected, truncated: files.length > selected.length };
    }
    if (action === "import") {
      requireAdmin(profile);
      if (!collectionPath(input.path)) fail(400, "invalid_path", "Blog 폴더의 Markdown 글만 가져올 수 있습니다.");
      let refreshEntry;
      if (input.id !== undefined || input.refresh === true) {
        refreshEntry = await loadEntry(input.id, profile);
        if (input.refresh !== true || refreshEntry.source_path !== input.path) fail(409, "version_conflict", "같은 Blog 원본의 작업 중인 글만 다시 가져올 수 있습니다.");
        checkVersion(refreshEntry, input.version);
        if (!["draft", "submitted", "changes_requested"].includes(refreshEntry.status)) fail(409, "invalid_state", "게시 중이거나 완료된 글은 다시 가져올 수 없습니다.");
      }
      const file = await gitFile(input.path, branch);
      if (!file || file.type !== "file" || !file.content || file.size > 300000) fail(404, "not_found", "가져올 수 있는 Blog 글을 찾지 못했습니다.");
      const { frontmatter, body } = parseDocument(decodeText(file.content));
      const fields = contentFields({ collection: "blog", title: frontmatter.title || input.path.split("/").at(-1).replace(/\.md$/, ""), date: String(frontmatter.date || input.path.match(/\d{4}-\d{2}-\d{2}/)?.[0] || today()).slice(0, 10), body, description: frontmatter.description || "", image_alt: frontmatter.image_alt || "", image_caption: frontmatter.image_caption || "" });
      if (refreshEntry) return { entry: publicEntry(await updateEntry(refreshEntry, { ...fields, frontmatter, base_sha: file.sha, status: "draft", feedback: "" })), refreshed: true };
      const [existing] = await db("cms_entries", `source_path=eq.${encodeURIComponent(input.path)}&collection=eq.blog&source_key=is.null&status=neq.published&limit=1`);
      if (existing) return { entry: publicEntry(existing), existing: true };
      const [entry] = await db("cms_entries", "", "POST", { id: uuid(), author_id: profile.id, ...fields, frontmatter, assets: [], source_path: input.path, source_key: null, base_sha: file.sha, status: "draft", version: 1 });
      return { entry: publicEntry(entry) };
    }
    fail(400, "unknown_action", "지원하지 않는 CMS 작업입니다.");
  }

  return async request => {
    const requestOrigin = request.headers.get("Origin");
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin", "Cache-Control": "no-store" };
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (!origin || !sb || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_ANON_KEY) return respond({ error: "not_configured", message: "CMS 연결 설정이 필요합니다." }, 503);
    if (requestOrigin && requestOrigin !== origin) return new Response(JSON.stringify({ error: "origin_denied", message: "허용되지 않은 홈페이지입니다." }), { status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return respond({ error: "method_not_allowed", message: "POST 요청만 사용할 수 있습니다." }, 405);
    try {
      const auth = request.headers.get("Authorization");
      if (!auth || !/^Bearer \S+$/.test(auth)) fail(401, "unauthorized", "로그인이 필요합니다.");
      const userResponse = await fetcher(`${sb}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
      if (!userResponse.ok) fail(401, "unauthorized", "로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const user = await userResponse.json();
      if (!user.id || !UUID.test(user.id)) fail(401, "unauthorized", "로그인을 확인할 수 없습니다.");
      const [profile] = await db("cms_profiles", `id=eq.${user.id}&limit=1`);
      if (!profile || profile.active !== true || !["editor", "admin"].includes(profile.role)) fail(403, "not_invited", "CMS에 초대된 계정만 사용할 수 있습니다.");
      // Read in bounded chunks rather than allocating an arbitrary request body.
      const reader = request.body?.getReader();
      if (!reader) fail(400, "invalid_request", "요청 내용이 필요합니다.");
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_REQUEST) { await reader.cancel(); fail(413, "request_too_large", "요청 크기가 너무 큽니다."); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let input;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, "invalid_request", "JSON 요청 형식이 올바르지 않습니다."); }
      if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "invalid_request", "요청 내용을 확인해 주세요.");
      const action = input.action;
      const payload = input.payload && typeof input.payload === "object" ? input.payload : input;
      if (["approve", "catalog", "import"].includes(action) && !env.GITHUB_TOKEN) fail(503, "github_not_configured", "GitHub 연결 설정이 필요합니다.");
      return respond(await dispatch(action, payload, profile));
    } catch (error) {
      if (error instanceof ApiError) return respond({ error: error.code, message: error.message }, error.status);
      // Never return upstream response bodies, tokens, or stack traces to the browser.
      return respond({ error: "service_unavailable", message: "CMS 연결에 일시적인 문제가 있습니다. 잠시 뒤 다시 시도해 주세요." }, 503);
    }
  };
}
