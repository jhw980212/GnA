import assert from "node:assert/strict";
import { createHandler } from "../../functions/cms-api/handler.js";

export const ADMIN = "11111111-1111-4111-8111-111111111111";
export const EDITOR = "22222222-2222-4222-8222-222222222222";
export const OTHER = "33333333-3333-4333-8333-333333333333";
export const ORIGIN = "https://galab.khu.ac.kr";
export const env = { SUPABASE_URL: "https://cms.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-secret", CMS_ORIGIN: ORIGIN, GITHUB_TOKEN: "github-secret", GITHUB_REPOSITORY: "exphysio/GnA", GITHUB_BRANCH: "main" };
export const content = (overrides = {}) => ({ collection: "blog", title: "연구실 공지", date: "2026-10-03", body: "행사에 참여해 주세요.\n\n[자세히](https://example.org)", description: "", image_alt: "", image_caption: "", ...overrides });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export function fixture(options = {}) {
  let sequence = 1;
  const state = {
    entries: [], profiles: [
      { id: ADMIN, email: "owner@example.org", display_name: "관리자", role: "admin", active: true },
      { id: EDITOR, email: "editor@example.org", display_name: "구성원", role: "editor", active: true },
      { id: OTHER, email: "other@example.org", display_name: "다른 구성원", role: "editor", active: true },
    ], storage: new Map(), blobs: new Map(), trees: new Map([["tree-head", {}]]),
    commits: new Map([["head-1", { sha: "head-1", tree: { sha: "tree-head" }, parents: [] }]]), head: "head-1", requests: [],
    refWrites: 0, publicationWrites: 0, failPublishWrite: false, failRefResponse: false, failRefBeforeWrite: false, concurrentRefOnce: false,
    omitContentPaths: new Set(), unavailableBlobPaths: new Set(),
  };
  const makeSha = prefix => `${prefix}-${sequence++}`;
  const makeUuid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence++).padStart(12, "0")}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const filters = (row, params) => [...params].every(([key, value]) => {
    if (["order", "limit", "select"].includes(key)) return true;
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("neq.")) return String(row[key]) !== value.slice(4);
    if (value === "is.null") return row[key] == null;
    throw Error(`Unexpected filter ${key} ${value}`);
  });
  const defaultRow = value => ({ assets: [], frontmatter: {}, details: {}, source_path: null, source_key: null, base_sha: null, feedback: "", publishing_token: null, publishing_started_at: null, pending_commit_sha: null, commit_sha: null, commit_url: null, created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", ...value });
  function isAncestor(ancestor, descendant) {
    if (ancestor === descendant) return true;
    return (state.commits.get(descendant)?.parents || []).some(parent => isAncestor(ancestor, parent.sha));
  }
  async function fetcher(url, init = {}) {
    const target = new URL(url);
    const method = init.method || "GET";
    const headers = new Headers(init.headers);
    let body = init.body;
    if (typeof body === "string") body = JSON.parse(body);
    state.requests.push({ url, method, body, headers });
    if (target.host === "cms.supabase.co") {
      if (target.pathname === "/auth/v1/user") {
        const id = { "Bearer admin": ADMIN, "Bearer editor": EDITOR, "Bearer other": OTHER }[headers.get("Authorization")];
        return id ? json({ id, user_metadata: { role: "admin" } }) : json({}, 401);
      }
      assert.equal(headers.get("Authorization"), "Bearer service-secret");
      if (target.pathname.startsWith("/rest/v1/")) {
        const table = target.pathname.endsWith("cms_entries") ? state.entries : state.profiles;
        if (method === "GET") return json(clone(table.filter(row => filters(row, target.searchParams))));
        if (method === "POST") { const row = defaultRow(body); table.push(row); return json([clone(row)], 201); }
        if (method === "PATCH") {
          if (body.status === "published") {
            state.publicationWrites++;
            if (state.failPublishWrite) { state.failPublishWrite = false; throw Error("lost database response"); }
          }
          const rows = table.filter(row => filters(row, target.searchParams));
          rows.forEach(row => Object.assign(row, body));
          return json(clone(rows));
        }
      }
      if (target.pathname === "/auth/v1/invite") return json({ id: OTHER });
      const storagePrefix = "/storage/v1/object/";
      if (target.pathname === `${storagePrefix}cms-assets` && method === "DELETE") { body.prefixes.forEach(path => state.storage.delete(path)); return json({}); }
      if (target.pathname.startsWith(`${storagePrefix}sign/cms-assets/`)) return json({ signedURL: `/object/sign/cms-assets/${target.pathname.split("/cms-assets/")[1]}?token=signed` });
      if (target.pathname.startsWith(`${storagePrefix}cms-assets/`)) {
        const path = decodeURIComponent(target.pathname.slice(`${storagePrefix}cms-assets/`.length));
        if (method === "POST") { state.storage.set(path, new Uint8Array(body)); return json({ Key: path }); }
        if (method === "GET") return new Response(state.storage.get(path) || null, { status: state.storage.has(path) ? 200 : 404 });
        if (method === "DELETE") { state.storage.delete(path); return json({}); }
      }
    }
    if (target.host === "api.github.com") {
      assert.equal(headers.get("Authorization"), "Bearer github-secret");
      const path = decodeURIComponent(target.pathname.replace("/repos/exphysio/GnA", ""));
      if (path === "/git/ref/heads/main") return json({ object: { sha: state.head } });
      if (path.startsWith("/contents/")) {
        const name = path.slice("/contents/".length);
        const ref = target.searchParams.get("ref");
        const commit = state.commits.get(ref === "main" ? state.head : ref);
        const tree = state.trees.get(commit?.tree.sha) || {};
        if (name === "_blog") return json(Object.entries(tree).filter(([file]) => file.startsWith(`${name}/`)).map(([file, sha]) => ({ name: file.split("/").at(-1), path: file, type: "file", sha })));
        const sha = tree[name];
        if (!sha) return json({}, 404);
        const blob = state.blobs.get(sha);
        return json({ type: "file", path: name, sha, content: state.omitContentPaths.has(name) ? "" : blob, encoding: state.omitContentPaths.has(name) ? "none" : "base64", size: Buffer.from(blob, "base64").length });
      }
      if (path === "/git/blobs") { const sha = makeSha("blob"); state.blobs.set(sha, body.content); return json({ sha }, 201); }
      if (path.startsWith("/git/blobs/")) {
        const sha = path.slice("/git/blobs/".length);
        if (state.unavailableBlobPaths.has(sha)) return json({ sha, encoding: "none", content: "" });
        return json({ sha, encoding: "base64", content: state.blobs.get(sha) });
      }
      if (path === "/git/trees") {
        const sha = makeSha("tree"); const tree = { ...state.trees.get(body.base_tree) };
        body.tree.forEach(item => { tree[item.path] = item.sha; }); state.trees.set(sha, tree); return json({ sha }, 201);
      }
      if (path.startsWith("/git/trees/")) return json({ tree: Object.entries(state.trees.get(path.slice("/git/trees/".length)) || {}).map(([name, sha]) => ({ path: name, sha, type: "blob" })), truncated: false });
      if (path === "/git/commits") {
        const sha = makeSha("commit"); state.commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents.map(parent => ({ sha: parent })) }); return json({ sha }, 201);
      }
      if (path.startsWith("/git/commits/")) return json(state.commits.get(path.slice("/git/commits/".length)));
      if (path === "/git/refs/heads/main") {
        assert.equal(body.force, false);
        if (state.failRefBeforeWrite) { state.failRefBeforeWrite = false; throw Error("connection lost before write"); }
        if (state.concurrentRefOnce) {
          state.concurrentRefOnce = false;
          const current = state.commits.get(state.head);
          const tree = { ...state.trees.get(current.tree.sha), "unrelated.txt": "unrelated-blob" };
          if (state.concurrentTreeChange) state.concurrentTreeChange(tree);
          state.trees.set("tree-concurrent", tree);
          state.commits.set("head-concurrent", { sha: "head-concurrent", tree: { sha: "tree-concurrent" }, parents: [{ sha: state.head }] });
          state.head = "head-concurrent";
          return json({}, 422);
        }
        if (!isAncestor(state.head, body.sha)) return json({}, 422);
        state.head = body.sha; state.refWrites++;
        if (state.failRefResponse) { state.failRefResponse = false; throw Error("GitHub response lost after successful write"); }
        return json({ object: { sha: body.sha } });
      }
      if (path.startsWith("/compare/")) {
        const [base] = path.slice("/compare/".length).split("...");
        const status = base === state.head ? "identical" : isAncestor(base, state.head) ? "ahead" : isAncestor(state.head, base) ? "behind" : "diverged";
        return json({ status });
      }
    }
    throw Error(`Unexpected request ${method} ${target}`);
  }
  const parseFixtureYaml = source => {
    const trimmed = source.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return JSON.parse(trimmed);
    if (trimmed.startsWith('"')) return Object.fromEntries(trimmed.split("\n").map(line => { const match = line.match(/^("(?:[^"\\]|\\.)*"): (.*)$/); if (!match) throw Error("Invalid fixture YAML"); return [JSON.parse(match[1]), JSON.parse(match[2])]; }));
    return { title: "원래 글", date: "2026-01-01", image: "images/original.jpg", published: false, custom: { keep: true } };
  };
  const handler = createHandler({ ...env, ...options.env }, { fetch: fetcher, now: () => new Date("2026-10-02T16:00:00Z"), uuid: makeUuid, parseYaml: options.parseYaml || parseFixtureYaml });
  async function call(action, payload = {}, token = "editor", origin = ORIGIN) {
    const response = await handler(new Request("https://cms.supabase.co/functions/v1/cms-api", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: origin }, body: JSON.stringify({ action, ...payload }) }));
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const create = async (overrides = {}, token = "editor") => (await call("save", { entry: content(overrides) }, token)).body.entry;
  const submit = async entry => (await call("submit", { id: entry.id, version: entry.version })).body.entry;
  return { state, call, create, submit, handler };
}
