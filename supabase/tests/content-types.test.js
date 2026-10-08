import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTIONS, collectionPath } from "../functions/cms-api/content-types.js";
import { renderEntryMarkdown } from "../functions/cms-api/handler.js";
import { fixture, content, ADMIN, EDITOR, OTHER } from "./support/mock-cms.js";

const LEGACY = ["notice", "member", "facility", "publication"];
const STATES = ["draft", "submitted", "changes_requested", "publishing", "published"];
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const PNG = PNG_BYTES.toString("base64");
const SOURCE = { notice: "_notice/original.md", member: "_members/Current/Phd/original.md", facility: "_data/facility.yaml", publication: "_data/citations.yaml" };

function seed(f, path, text) {
  const sha = `seed-${f.state.blobs.size}`;
  f.state.blobs.set(sha, Buffer.from(text).toString("base64"));
  f.state.trees.get(f.state.commits.get(f.state.head).tree.sha)[path] = sha;
  return sha;
}
const markdown = (title = "Original Blog") => `---\n${JSON.stringify({ title, date: "2026-01-01", published: true, custom: { keep: true } })}\n---\n\nOriginal story.\n`;
function read(f, path) {
  const sha = f.state.trees.get(f.state.commits.get(f.state.head).tree.sha)[path];
  return Buffer.from(f.state.blobs.get(sha), "base64").toString("utf8");
}
function frontmatter(text) {
  const source = text.match(/^---\n([\s\S]*?)\n---/)[1];
  return Object.fromEntries(source.split("\n").map(line => {
    const match = line.match(/^("(?:[^"\\]|\\.)*"): (.*)$/);
    return [JSON.parse(match[1]), JSON.parse(match[2])];
  }));
}
function noWritesOrPrivateReads(f) {
  assert.equal(f.state.requests.some(request => new URL(request.url).host === "api.github.com"), false, "denied operation must not contact GitHub");
  assert.equal(f.state.requests.some(request => new URL(request.url).pathname.startsWith("/storage/")), false, "denied operation must not upload or sign a private photo");
  assert.equal(f.state.requests.some(request => request.method !== "GET"), false, "denied operation must not mutate auth or database state");
  assert.equal(f.state.refWrites, 0);
}
const actions = entry => [
  ["save", { entry: content({ id: entry.id }), version: entry.version }],
  ["upload", { id: entry.id, version: entry.version, name: "photo.png", mime: "image/png", base64: PNG }],
  ["assets", { id: entry.id }],
  ["submit", { id: entry.id, version: entry.version }],
  ["reject", { id: entry.id, version: entry.version, feedback: "Please revise." }],
  ["approve", { id: entry.id, version: entry.version }],
];

test("CMS accepts only Blog paths and its renderer rejects every legacy type", () => {
  assert.deepEqual(COLLECTIONS, ["blog"]);
  assert.equal(collectionPath("_blog/2026-01-01-연구실 이야기.md"), true);
  for (const path of [...Object.values(SOURCE), "_blog/subfolder/post.md", "_blog/../post.md", "_blog\\post.md", "_blog/post.md\n", "_blog/post.html", "_config.yaml"]) {
    assert.equal(collectionPath(path), false, path);
  }
  for (const collection of LEGACY) {
    assert.equal(collectionPath("_blog/post.md", collection), false);
    assert.throws(() => renderEntryMarkdown({ collection }), error => error.code === "invalid_collection");
  }
});

test("both editor and owner cannot create non-Blog records, including forged admin claims", async () => {
  for (const token of ["editor", "admin"]) for (const collection of [...LEGACY, "admin", "Blog", null]) {
    const f = fixture();
    const result = await f.call("save", { entry: content({ collection, role: "admin", author_id: ADMIN, details: { role: "phd" } }) }, token);
    assert.equal(result.status, 400, `${token}/${collection}`);
    assert.equal(result.body.error, "invalid_collection");
    assert.deepEqual(f.state.entries, []);
    noWritesOrPrivateReads(f);
  }
});

test("all entry actions deny self-authored legacy types in every state for both roles", async () => {
  for (const token of ["editor", "admin"]) for (const collection of LEGACY) for (const status of STATES) {
    const f = fixture();
    const entry = await f.create({}, token);
    Object.assign(f.state.entries[0], { collection, status, source_path: SOURCE[collection], source_key: collection === "facility" || collection === "publication" ? "0" : null, details: { unknown: "preserve" }, publishing_token: "old-lease", pending_commit_sha: "old-commit", assets: [{ path: `${entry.author_id}/${entry.id}/old.png`, alt: "old photo" }] });
    const before = structuredClone(f.state.entries);
    f.state.requests.length = 0;
    for (const [action, payload] of actions(entry)) {
      const result = await f.call(action, payload, token);
      const expected = token === "editor" && ["reject", "approve"].includes(action) ? 403 : 404;
      assert.equal(result.status, expected, `${token}/${collection}/${status}/${action}: ${JSON.stringify(result.body)}`);
    }
    assert.deepEqual(f.state.entries, before, "legacy contents, assets and publish lease must remain untouched");
    noWritesOrPrivateReads(f);
  }
});

test("list filters Blog at the database for both roles and retains all legacy rows", async () => {
  const f = fixture();
  const own = await f.create(), other = await f.create({}, "other"), owner = await f.create({}, "admin");
  for (const token of ["editor", "admin"]) for (const collection of LEGACY) {
    const entry = await f.create({}, token);
    f.state.entries.find(row => row.id === entry.id).collection = collection;
  }
  const before = structuredClone(f.state.entries);
  for (const token of ["editor", "admin"]) {
    f.state.requests.length = 0;
    const result = await f.call("list", { collection: "member", role: "admin", author_id: OTHER }, token);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.entries.map(entry => entry.id).sort(), (token === "editor" ? [own.id] : [own.id, other.id, owner.id]).sort());
    const query = f.state.requests.find(request => new URL(request.url).pathname.endsWith("/cms_entries"));
    const params = new URL(query.url).searchParams;
    assert.equal(params.get("collection"), "eq.blog");
    assert.equal(params.get("author_id"), token === "editor" ? `eq.${EDITOR}` : null);
    noWritesOrPrivateReads(f);
  }
  assert.deepEqual(f.state.entries, before);
});

test("catalog visits only root Blog files and does not read structural data", async () => {
  const f = fixture();
  const allowed = ["_blog/2026-01-01-story.md", "_blog/한국어 이름.md"];
  allowed.forEach((path, index) => seed(f, path, markdown(`Story ${index}`)));
  for (const path of [...Object.values(SOURCE), "_blog/nested/story.md", "_blog/notes.txt"]) seed(f, path, markdown("Outside scope"));
  const result = await f.call("catalog", { collection: "member" }, "admin");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.files.map(file => file.path).sort(), allowed.sort());
  assert.deepEqual(result.body.files.map(file => file.title).sort(), ["Story 0", "Story 1"]);
  assert.ok(result.body.files.every(file => file.collection === "blog" && file.source_key === null));
  const github = f.state.requests.filter(request => new URL(request.url).host === "api.github.com");
  assert.deepEqual(github.map(request => decodeURIComponent(new URL(request.url).pathname.split("/contents/")[1])).sort(), ["_blog", ...allowed].sort());
  assert.ok(github.every(request => request.method === "GET"));
  assert.equal((await f.call("catalog", {}, "editor")).status, 403);
});

test("import and refresh reject non-Blog paths before GitHub for either role", async () => {
  for (const token of ["editor", "admin"]) for (const path of [...Object.values(SOURCE), "_blog/nested/post.md", "_blog/../post.md", "_blog\\post.md", "_config.yaml"]) for (const refresh of [false, true]) {
    const f = fixture();
    const result = await f.call("import", { path, source_key: "0", refresh, id: ADMIN, version: 1 }, token);
    assert.equal(result.status, token === "admin" ? 400 : 403, `${token}/${path}/${refresh}`);
    assert.deepEqual(f.state.entries, []);
    noWritesOrPrivateReads(f);
  }
});

test("allowed Blog path cannot refresh or reuse a legacy entry ID, even with no existing Blog draft", async () => {
  for (const token of ["editor", "admin"]) for (const collection of LEGACY) for (const status of STATES) {
    const f = fixture(), entry = await f.create({}, token);
    Object.assign(f.state.entries[0], { collection, status, source_path: SOURCE[collection] });
    seed(f, "_blog/new.md", markdown());
    const before = structuredClone(f.state.entries);
    f.state.requests.length = 0;
    for (const refresh of [undefined, true]) {
      const result = await f.call("import", { path: "_blog/new.md", id: entry.id, version: entry.version, refresh }, token);
      assert.equal(result.status, token === "admin" ? 404 : 403, `${token}/${collection}/${status}/${refresh}`);
    }
    assert.deepEqual(f.state.entries, before);
    noWritesOrPrivateReads(f);
  }
});

test("refresh requires a matching Blog draft, source, version and editable state before GitHub", async () => {
  for (const changes of [
    { id: undefined }, { path: "_blog/other.md" }, { version: 2 }, { refresh: false }, { status: "published" }, { status: "publishing" },
  ]) {
    const f = fixture(), entry = await f.create({}, "admin");
    Object.assign(f.state.entries[0], { source_path: "_blog/original.md", status: changes.status || "draft" });
    const before = structuredClone(f.state.entries);
    f.state.requests.length = 0;
    const result = await f.call("import", { path: "_blog/original.md", id: entry.id, version: entry.version, refresh: true, ...changes }, "admin");
    assert.equal(result.status, changes.id === undefined && Object.hasOwn(changes, "id") ? 400 : 409, JSON.stringify(changes));
    assert.deepEqual(f.state.entries, before);
    noWritesOrPrivateReads(f);
  }
});

test("forged structural paths, frontmatter, roles and details never alter new Blog ownership or scope", async () => {
  for (const token of ["editor", "admin"]) {
    const f = fixture();
    const result = await f.call("save", { entry: content({ author_id: OTHER, status: "published", version: 900, source_path: "_members/forged.md", source_key: "0", frontmatter: { role: "admin", layout: "member" }, details: { hidden: true, role: "phd" } }), source_path: "_data/citations.yaml", role: "admin" }, token);
    assert.equal(result.status, 200);
    const entry = result.body.entry;
    assert.equal(entry.author_id, token === "admin" ? ADMIN : EDITOR);
    assert.equal(entry.collection, "blog"); assert.equal(entry.status, "draft"); assert.equal(entry.version, 1);
    assert.equal(entry.source_path, null); assert.equal(entry.source_key, null);
    assert.deepEqual(entry.frontmatter, {}); assert.deepEqual(entry.details, {});
    assert.equal(f.state.requests.some(request => new URL(request.url).host === "api.github.com"), false);
  }
});

test("mislabelled legacy records with non-Blog source paths are blocked before assets or publishing", async () => {
  for (const token of ["editor", "admin"]) for (const path of Object.values(SOURCE)) {
    const f = fixture(), entry = await f.create({}, token);
    Object.assign(f.state.entries[0], { source_path: path });
    const before = structuredClone(f.state.entries);
    f.state.requests.length = 0;
    for (const [action, payload] of actions(entry)) {
      const result = await f.call(action, payload, token);
      assert.equal(result.status, 403, `${token}/${path}/${action}`);
    }
    assert.deepEqual(f.state.entries, before); noWritesOrPrivateReads(f);
  }
});

test("Blog stories and ten photos publish atomically with owner approval while structural files survive", async () => {
  const f = fixture();
  const original = Object.fromEntries(Object.values(SOURCE).map(path => [path, `Original bytes: ${path}\n`]));
  for (const [path, value] of Object.entries(original)) seed(f, path, value);
  let entry = await f.create({ title: "Lab story", body: "We shared our research today.", description: "A Blog story" });
  for (let photo = 0; photo < 10; photo++) {
    const result = await f.call("upload", { id: entry.id, version: entry.version, name: `photo-${photo}.png`, mime: "image/png", base64: PNG });
    assert.equal(result.status, 200); entry = result.body.entry;
  }
  const saved = await f.call("save", { entry: { ...entry, assets: entry.assets.map((asset, index) => ({ ...asset, alt: `Photo ${index}`, caption: `Caption ${index}` })) }, version: entry.version });
  assert.equal(saved.status, 200); entry = await f.submit(saved.body.entry);
  assert.equal((await f.call("approve", { id: entry.id, version: entry.version })).status, 403);
  const approved = await f.call("approve", { id: entry.id, version: entry.version }, "admin");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.deployment, "queued");
  const published = approved.body.entry;
  assert.match(published.source_path, /^_blog\/2026-10-03-[^/]+\.md$/);
  const text = read(f, published.source_path), front = frontmatter(text);
  assert.match(text, /We shared our research today/); assert.equal(front.published, true);
  assert.equal(front.cms_entry_id, published.id); assert.equal(front.gallery.length, 9);
  assert.equal(front.image_alt, "Photo 0"); assert.equal(front.gallery[8].caption, "Caption 9");
  const tree = f.state.trees.get(f.state.commits.get(f.state.head).tree.sha);
  for (const path of [front.image, ...front.gallery.map(photo => photo.image)]) assert.deepEqual(Buffer.from(f.state.blobs.get(tree[path]), "base64"), PNG_BYTES);
  for (const [path, value] of Object.entries(original)) assert.equal(read(f, path), value);
  assert.equal(f.state.refWrites, 1);
  const retry = await f.call("approve", { id: published.id, version: entry.version }, "admin");
  assert.equal(retry.status, 200); assert.equal(retry.body.commitCreated, false); assert.equal(f.state.refWrites, 1);
});

test("Blog imports safely read immutable blob bytes when GitHub omits inline contents", async () => {
  const f = fixture(), path = "_blog/2026-01-01-original.md";
  seed(f, path, markdown()); f.state.omitContentPaths.add(path);
  const result = await f.call("import", { path }, "admin");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.entry.collection, "blog"); assert.equal(result.body.entry.title, "Original Blog");
  assert.equal(result.body.entry.source_path, path);
  assert.ok(f.state.requests.some(request => request.url.includes("/git/blobs/seed-")));
});
