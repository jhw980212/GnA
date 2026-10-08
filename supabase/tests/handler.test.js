import test from "node:test";
import assert from "node:assert/strict";
import { fixture, ADMIN, EDITOR, OTHER, ORIGIN, env, content } from "./support/mock-cms.js";

test("CORS rejects other sites before authenticating; bearer token is validated", async () => {
  const f = fixture();
  assert.equal((await f.call("profile", {}, "admin", "https://evil.test")).status, 403);
  assert.equal(f.state.requests.length, 0);
  assert.equal((await f.call("profile", {}, "invalid")).status, 401);
  const profile = await f.call("profile", {}, "editor");
  assert.equal(profile.body.profile.role, "editor", "user_metadata admin claim must not grant role");
  assert.equal(profile.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("missing secrets reports configuration without leaking the secret", async () => {
  const f = fixture({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  const result = await f.call("profile");
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.body).includes("service-secret"), false);
});

test("editor can save and see own empty-body posts but cannot see another editor's posts", async () => {
  const f = fixture();
  const entry = await f.create({ body: "" });
  assert.equal(entry.status, "draft");
  assert.equal(entry.author_id, EDITOR);
  const list = await f.call("list", {}, "other");
  assert.deepEqual(list.body.entries, []);
  assert.equal((await f.call("assets", { id: entry.id }, "other")).status, 404);
  assert.equal((await f.call("list", {}, "admin")).body.entries.length, 1);
});

test("stale version cannot overwrite new changes; version is mandatory", async () => {
  const f = fixture(); const entry = await f.create();
  const first = await f.call("save", { entry: { ...content({ title: "최신 제목" }), id: entry.id }, version: entry.version });
  assert.equal(first.body.entry.version, 2);
  assert.equal((await f.call("save", { entry: { ...content({ title: "오래된 제목" }), id: entry.id }, version: entry.version })).status, 409);
  assert.equal((await f.call("submit", { id: entry.id })).status, 400);
  assert.equal(f.state.entries[0].title, "최신 제목");
});

test("HTML, Liquid, unsafe links, invalid dates and future Korea dates are rejected", async () => {
  const f = fixture();
  for (const overrides of [{ body: "<script>alert(1)</script>" }, { body: "{{ site.secret }}" }, { body: "![x](/bad.jpg){: onerror=alert(1)}" }, { body: "{::nomarkdown}anything{:/}" }, { body: "[click](javascript:alert(1))" }, { body: "[click](j%61vascript:alert(1))" }, { body: "[click](file:///etc/passwd)" }, { date: "2026-02-30" }, { date: "2026-10-04" }])
    assert.equal((await f.call("save", { entry: content(overrides) })).status, 400);
  assert.equal((await f.call("save", { entry: content({ date: "2026-10-03" }) })).status, 200, "today is Oct 3 in Korea even when UTC is Oct 2");
});

test("editor can submit; only administrator can approve or request changes", async () => {
  const f = fixture(); const entry = await f.submit(await f.create());
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version })).status, 403);
  assert.equal((await f.call("invite", { email: "user@example.org" })).status, 403);
  assert.equal((await f.call("reject", { id: entry.id, version: entry.version, feedback: "사진을 추가해 주세요." })).status, 403);
  const rejected = await f.call("reject", { id: entry.id, version: entry.version, feedback: "사진을 추가해 주세요." }, "admin");
  assert.equal(rejected.body.entry.status, "changes_requested");
  assert.equal(rejected.body.entry.feedback, "사진을 추가해 주세요.");
});

test("photos require verified raster magic and cannot inject arbitrary paths", async () => {
  const f = fixture(); const entry = await f.create();
  const fake = await f.call("upload", { id: entry.id, version: entry.version, name: "photo.png", mime: "image/png", base64: Buffer.from("<svg>bad</svg>").toString("base64") });
  assert.equal(fake.status, 400);
  assert.equal((await f.call("upload", { id: entry.id, version: entry.version, mime: "constructor", base64: Buffer.from("RIFF0000WEBP").toString("base64") })).status, 400);
  assert.equal((await f.call("upload", { id: entry.id, version: entry.version, mime: "image/svg+xml", base64: "" })).status, 400);
  const uploaded = await f.call("upload", { id: entry.id, version: entry.version, name: "사진.png", mime: "image/png", base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString("base64") });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.asset.path.startsWith(`${EDITOR}/${entry.id}/`), true);
  assert.equal(uploaded.body.entry.version, 2);
  const assets = await f.call("assets", { id: entry.id });
  assert.equal(assets.body.assets[0].url.startsWith("https://cms.supabase.co/storage/v1/object/sign/"), true);
  assert.equal((await f.call("save", { entry: { ...content(), id: entry.id, assets: [{ path: `${OTHER}/private.png` }] }, version: 2 })).status, 400);
});

test("submitted pictures and content stay immutable while awaiting approval", async () => {
  const f = fixture(); const entry = await f.submit(await f.create());
  assert.equal((await f.call("save", { entry: { ...content(), id: entry.id }, version: entry.version })).status, 409);
  assert.equal((await f.call("upload", { id: entry.id, version: entry.version, mime: "image/png", base64: "" })).status, 409);
});

test("photo count and per-photo size limits are enforced server-side", async () => {
  const f = fixture(); let entry = await f.create();
  const base64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString("base64");
  for (let photo = 0; photo < 10; photo++) entry = (await f.call("upload", { id: entry.id, version: entry.version, mime: "image/png", base64 })).body.entry;
  assert.equal((await f.call("upload", { id: entry.id, version: entry.version, mime: "image/png", base64 })).body.error, "asset_limit");
  const second = await f.create();
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
  assert.equal((await f.call("upload", { id: second.id, version: second.version, mime: "image/png", base64: oversized })).status, 413);
});

test("approval publishes one atomic commit and is idempotent", async () => {
  const f = fixture(); const entry = await f.submit(await f.create());
  const result = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.status, "published");
  assert.equal(result.body.deployment, "queued");
  assert.equal(result.body.commitCreated, true);
  assert.equal(f.state.refWrites, 1);
  const tree = f.state.trees.get(f.state.commits.get(f.state.head).tree.sha);
  const path = result.body.entry.source_path;
  const markdown = Buffer.from(f.state.blobs.get(tree[path]), "base64").toString("utf8");
  assert.match(path, /^_blog\/2026-10-03-/);
  assert.match(markdown, new RegExp(`"cms_entry_id": "${entry.id}"`));
  assert.equal(JSON.stringify(result.body).includes("publishing_token"), false);
  const retry = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(retry.body.commitCreated, false);
  assert.equal(f.state.refWrites, 1);
});

test("unrelated concurrent GitHub commit is preserved by rebuilding the tree", async () => {
  const f = fixture(); const entry = await f.submit(await f.create()); f.state.concurrentRefOnce = true;
  const result = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(result.status, 200);
  const tree = f.state.trees.get(f.state.commits.get(f.state.head).tree.sha);
  assert.equal(tree["unrelated.txt"], "unrelated-blob");
  assert.ok(tree[result.body.entry.source_path]);
});

test("lost database response after GitHub commit reconciles without duplicate publication", async () => {
  const f = fixture(); const entry = await f.submit(await f.create()); f.state.failPublishWrite = true;
  const first = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(first.status, 503);
  assert.equal(first.body.error, "publishing_uncertain");
  assert.equal(f.state.entries[0].status, "publishing");
  assert.equal(f.state.refWrites, 1);
  const recovered = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.entry.status, "published");
  assert.equal(f.state.refWrites, 1);
});

test("lost GitHub response after commit also reconciles without duplicate publication", async () => {
  const f = fixture(); const entry = await f.submit(await f.create()); f.state.failRefResponse = true;
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version }, "admin")).status, 503);
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version }, "admin")).body.entry.status, "published");
  assert.equal(f.state.refWrites, 1);
});

test("connection lost before GitHub update retries the same prepared commit", async () => {
  const f = fixture(); const entry = await f.submit(await f.create()); f.state.failRefBeforeWrite = true;
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version }, "admin")).status, 503);
  const pending = f.state.entries[0].pending_commit_sha;
  assert.equal(f.state.refWrites, 0);
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version }, "admin")).body.entry.status, "published");
  assert.equal(f.state.head, pending);
  assert.equal(f.state.refWrites, 1);
  assert.equal(f.state.commits.size, 2, "retry must not create another commit");
});

test("parallel saves use a database compare-and-swap, allowing exactly one winner", async () => {
  const f = fixture(); const entry = await f.create();
  const results = await Promise.all(["제목 A", "제목 B"].map(title => f.call("save", { entry: { ...content({ title }), id: entry.id }, version: entry.version })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(f.state.entries[0].version, 2);
});

test("parallel approvals do not create two commits", async () => {
  const f = fixture(); const entry = await f.submit(await f.create());
  const results = await Promise.all([1, 2].map(() => f.call("approve", { id: entry.id, version: entry.version }, "admin")));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(f.state.refWrites, 1);
});

test("imported Korean paths and unknown frontmatter survive approval", async () => {
  const f = fixture();
  const path = "_blog/심혈관 연구 대상자 모집.md";
  f.state.blobs.set("original-blob", Buffer.from('---\ntitle: "원래 글"\ndate: 2026-01-01\nimage: images/original.jpg\n---\n내용').toString("base64"));
  f.state.trees.get("tree-head")[path] = "original-blob";
  const imported = await f.call("import", { path }, "admin");
  assert.equal(imported.status, 200);
  const entry = imported.body.entry;
  assert.equal(entry.base_sha, "original-blob");
  const submitted = await f.call("submit", { id: entry.id, version: entry.version }, "admin");
  const published = await f.call("approve", { id: entry.id, version: submitted.body.entry.version }, "admin");
  assert.equal(published.body.entry.source_path, path);
  const tree = f.state.trees.get(f.state.commits.get(f.state.head).tree.sha);
  const markdown = Buffer.from(f.state.blobs.get(tree[path]), "base64").toString("utf8");
  assert.match(markdown, /"image": "images\/original.jpg"/);
  assert.match(markdown, /"custom": \{"keep":true\}/);
  assert.match(markdown, /"published": true/, "approved imported drafts must be publicly visible");
});

test("catalog reads real frontmatter title and rejects arbitrary import paths", async () => {
  const f = fixture(); const path = "_blog/filename.md";
  f.state.blobs.set("catalog-blob", Buffer.from("---\ntitle: 실제 제목\n---\n내용").toString("base64"));
  f.state.trees.get("tree-head")[path] = "catalog-blob";
  const catalog = await f.call("catalog", {}, "admin");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.files[0].title, "원래 글", "uses injected YAML parser title instead of filename");
  assert.equal((await f.call("import", { path: "_blog/../_config.yaml" }, "admin")).status, 400);
  assert.equal((await f.call("import", { path: "_blog/subdir/post.md" }, "admin")).status, 400);
});

test("GitHub changes to imported content prevent overwriting the new source", async () => {
  const f = fixture(); const path = "_blog/existing.md";
  f.state.blobs.set("original-blob", Buffer.from("---\ntitle: 원래 글\n---\n내용").toString("base64"));
  f.state.trees.get("tree-head")[path] = "original-blob";
  const imported = (await f.call("import", { path }, "admin")).body.entry;
  const submitted = (await f.call("submit", { id: imported.id, version: imported.version }, "admin")).body.entry;
  f.state.trees.get("tree-head")[path] = "changed-blob";
  f.state.blobs.set("changed-blob", Buffer.from("---\ntitle: 변경 글\n---\n변경된 내용").toString("base64"));
  const result = await f.call("approve", { id: submitted.id, version: submitted.version }, "admin");
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "source_changed");
  assert.equal(f.state.entries[0].status, "submitted");
  assert.equal(f.state.refWrites, 0);
});

test("invitation uses configured admin redirect and no signup-role privilege", async () => {
  const f = fixture();
  const result = await f.call("invite", { email: "colleague@example.org", display_name: "동료" }, "admin");
  assert.equal(result.status, 200);
  const invite = f.state.requests.find(request => request.url.includes("/auth/v1/invite"));
  assert.equal(new URL(invite.url).searchParams.get("redirect_to"), `${ORIGIN}/admin/`);
  assert.deepEqual(invite.body.data, { display_name: "동료" });
});

test("uninvited Supabase accounts remain blocked even if Auth allows signup", async () => {
  const f = fixture(); f.state.profiles.find(profile => profile.id === EDITOR).active = false;
  assert.equal((await f.call("profile")).status, 403);
  assert.equal((await f.call("save", { entry: content() })).status, 403);
});

test("administrator can explicitly refresh a stale imported draft with a version check", async () => {
  const f = fixture(); const path = "_blog/existing.md";
  f.state.blobs.set("original-blob", Buffer.from("---\ntitle: 원래 글\n---\n원본").toString("base64"));
  f.state.trees.get("tree-head")[path] = "original-blob";
  const entry = (await f.call("import", { path }, "admin")).body.entry;
  f.state.blobs.set("updated-blob", Buffer.from("---\ntitle: 원래 글\n---\n최신 본문").toString("base64"));
  f.state.trees.get("tree-head")[path] = "updated-blob";
  assert.equal((await f.call("import", { path, refresh: true, id: entry.id, version: 100 }, "admin")).status, 409);
  const result = await f.call("import", { path, refresh: true, id: entry.id, version: entry.version }, "admin");
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.base_sha, "updated-blob");
  assert.equal(result.body.entry.body, "최신 본문");
  assert.equal(result.body.entry.status, "draft");
});
