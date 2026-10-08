import test from "node:test";
import assert from "node:assert/strict";
import { setupSharedUsers, parseEnvFile } from "../scripts/setup-shared-users.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const env = {
  SUPABASE_URL: "https://cms.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-secret",
  CMS_OWNER_EMAIL: "owner@example.org", CMS_OWNER_PASSWORD: "OwnerTest!123456",
  CMS_MEMBER_EMAIL: "member@example.org", CMS_MEMBER_PASSWORD: "MemberTest!123456",
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function fixture({ existing = false } = {}) {
  const state = { requests: [], users: [], profiles: [], listPages: null };
  if (existing) {
    state.users = [{ id: OWNER, email: env.CMS_OWNER_EMAIL }, { id: MEMBER, email: env.CMS_MEMBER_EMAIL }];
    state.profiles = [{ id: OWNER, email: env.CMS_OWNER_EMAIL, role: "admin", active: true, display_name: "원래 관리자" }, { id: MEMBER, email: env.CMS_MEMBER_EMAIL, role: "editor", active: true, display_name: "구성원" }];
  }
  async function fetcher(url, init = {}) {
    const target = new URL(url), method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    const headers = new Headers(init.headers);
    assert.equal(init.redirect, "error", "service credentials must not follow redirects");
    assert.ok(init.signal instanceof AbortSignal, "requests need a bounded timeout");
    assert.equal(headers.get("Authorization"), `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    state.requests.push({ url, method, body });
    if (target.pathname === "/auth/v1/admin/users" && method === "GET") {
      const page = Number(target.searchParams.get("page"));
      return json(state.listPages ? state.listPages[page - 1] : { users: state.users });
    }
    if (target.pathname === "/auth/v1/admin/users" && method === "POST") {
      const id = body.email === env.CMS_OWNER_EMAIL ? OWNER : MEMBER;
      const user = { id, email: body.email }; state.users.push(user);
      state.profiles.push({ id, email: body.email, role: "editor", active: false, display_name: body.user_metadata.display_name });
      assert.equal(body.email_confirm, true);
      assert.equal("role" in body.user_metadata, false);
      assert.equal("app_metadata" in body, false);
      return json(user, 201);
    }
    if (target.pathname.startsWith("/auth/v1/admin/users/") && method === "PUT") return json({ user: { id: target.pathname.split("/").at(-1) } });
    if (target.pathname === "/rest/v1/cms_profiles") {
      const id = target.searchParams.get("id")?.slice(3);
      const profiles = id ? state.profiles.filter(profile => profile.id === id) : state.profiles;
      if (method === "GET") return json(structuredClone(profiles));
      if (method === "PATCH") {
        const role = target.searchParams.get("role")?.slice(3);
        const active = target.searchParams.get("active")?.slice(3) === "true";
        const matching = profiles.filter(profile => profile.role === role && profile.active === active);
        matching.forEach(profile => Object.assign(profile, body));
        return json(structuredClone(matching));
      }
    }
    throw Error(`Unexpected ${method} ${target.pathname}`);
  }
  return { state, fetcher };
}

test("new shared accounts use confirmed password Auth users and protected profile roles, without email", async () => {
  const f = fixture();
  const results = await setupSharedUsers(env, { fetch: f.fetcher });
  assert.deepEqual(results.map(result => [result.account, result.role, result.created]), [["owner", "admin", true], ["member", "editor", true]]);
  assert.equal(f.state.profiles.find(profile => profile.id === OWNER).active, true);
  assert.equal(f.state.profiles.find(profile => profile.id === OWNER).role, "admin");
  assert.equal(f.state.profiles.find(profile => profile.id === MEMBER).role, "editor");
  assert.equal(f.state.requests.some(request => /invite|recover|otp/.test(request.url)), false);
  for (const value of [env.SUPABASE_SERVICE_ROLE_KEY, env.CMS_OWNER_EMAIL, env.CMS_OWNER_PASSWORD, env.CMS_MEMBER_PASSWORD])
    assert.equal(JSON.stringify(results).includes(value), false);
});

test("reruns reuse exact matching existing accounts with no writes or silent password changes", async () => {
  const f = fixture({ existing: true });
  const results = await setupSharedUsers({ ...env, CMS_OWNER_PASSWORD: "DifferentOwner!123", CMS_MEMBER_PASSWORD: "DifferentMember!123" }, { fetch: f.fetcher });
  assert.equal(results.every(result => !result.created && !result.passwordChanged), true);
  assert.equal(f.state.requests.every(request => request.method === "GET"), true);
  assert.equal(f.state.profiles[0].display_name, "원래 관리자");
});

test("existing editor cannot be promoted to owner, even with explicit password reset", async () => {
  const f = fixture({ existing: true }); f.state.profiles[0].role = "editor";
  await assert.rejects(setupSharedUsers(env, { fetch: f.fetcher, resetPasswords: true }), /Refusing to change its privileges/);
  assert.equal(f.state.requests.every(request => request.method === "GET"), true);
  assert.equal(f.state.profiles[0].role, "editor");
});

test("shared member cannot reuse and downgrade an existing admin", async () => {
  const f = fixture({ existing: true }); f.state.profiles[1].role = "admin";
  await assert.rejects(setupSharedUsers(env, { fetch: f.fetcher }), /Refusing to change its privileges/);
  assert.equal(f.state.requests.every(request => request.method === "GET"), true);
});

test("password changes require explicit reset mode and keep protected roles", async () => {
  const f = fixture({ existing: true });
  const result = await setupSharedUsers(env, { fetch: f.fetcher, resetPasswords: true });
  const resets = f.state.requests.filter(request => request.method === "PUT");
  assert.equal(resets.length, 2);
  assert.deepEqual(resets.map(request => request.body.password), [env.CMS_OWNER_PASSWORD, env.CMS_MEMBER_PASSWORD]);
  assert.equal(result.every(account => account.passwordChanged), true);
  assert.equal(f.state.profiles[0].role, "admin");
  assert.equal(f.state.profiles[1].role, "editor");
});

test("inactive existing accounts activate only their previously assigned roles", async () => {
  const f = fixture({ existing: true }); f.state.profiles.forEach(profile => { profile.active = false; });
  await setupSharedUsers(env, { fetch: f.fetcher });
  assert.equal(f.state.profiles.every(profile => profile.active), true);
  assert.equal(f.state.requests.filter(request => request.method === "PATCH").length, 2);
  assert.equal(f.state.requests.some(request => request.method === "PUT"), false);
});

test("paginated lookup reuses account from later page and ignores similar email", async () => {
  const f = fixture({ existing: true });
  f.state.listPages = [
    { users: [{ id: "33333333-3333-4333-8333-333333333333", email: "prefix-owner@example.org" }], next_page: 2 },
    { users: f.state.users },
  ];
  const results = await setupSharedUsers(env, { fetch: f.fetcher });
  assert.equal(results.every(result => !result.created), true);
  assert.equal(f.state.requests.filter(request => request.url.includes("/admin/users?")).length, 2);
});

test("same account/password and weak passwords are rejected before requests", async () => {
  const f = fixture();
  for (const overrides of [{ CMS_OWNER_PASSWORD: "short" }, { CMS_OWNER_PASSWORD: "a".repeat(129) }, { CMS_MEMBER_EMAIL: env.CMS_OWNER_EMAIL }, { CMS_MEMBER_PASSWORD: env.CMS_OWNER_PASSWORD }, { SUPABASE_URL: "http://unsafe.example.org" }])
    await assert.rejects(setupSharedUsers({ ...env, ...overrides }, { fetch: f.fetcher }));
  assert.equal(f.state.requests.length, 0);
});

test("upstream errors do not reveal secrets or arbitrary server response bodies", async () => {
  const malicious = `${env.CMS_OWNER_PASSWORD} ${env.SUPABASE_SERVICE_ROLE_KEY}`;
  await assert.rejects(setupSharedUsers(env, { fetch: async () => json({ error: malicious }, 403) }), error => {
    assert.match(error.message, /HTTP 403/);
    assert.equal(error.message.includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
    assert.equal(error.message.includes(env.CMS_OWNER_PASSWORD), false);
    return true;
  });
});

test("env parser treats credentials literally and rejects malformed/duplicate variables", () => {
  const parsed = parseEnvFile("# private\nCMS_OWNER_PASSWORD='Password!$(not-a-command)123'\nCMS_MEMBER_PASSWORD=Another!123456\nexport SUPABASE_URL=https://cms.supabase.co\n");
  assert.equal(parsed.CMS_OWNER_PASSWORD, "Password!$(not-a-command)123");
  assert.equal(parsed.SUPABASE_URL, env.SUPABASE_URL);
  assert.throws(() => parseEnvFile("CMS_OWNER_PASSWORD=abc\nCMS_OWNER_PASSWORD=def"), /duplicate/);
  assert.throws(() => parseEnvFile("CMS_OWNER_PASSWORD='unclosed"), /Invalid quoted/);
  assert.throws(() => parseEnvFile("__proto__=unsafe"), /Invalid environment key/);
});
