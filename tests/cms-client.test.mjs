import test from "node:test";
import assert from "node:assert/strict";
import { createClient, validateConfig } from "../admin/client.js";

const config = { supabaseUrl: "https://example.supabase.co", publishableKey: "sb_publishable_example", functionName: "cms-api" };
const tokenFragment = "#access_token=access&refresh_token=refresh&expires_at=9999999999&type=invite";
function environment({ hash = "", savedSession } = {}) {
  const values = new Map();
  if (savedSession) values.set("galab-cms-session-v1", JSON.stringify(savedSession));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const history = [];
  const window = { sessionStorage: storage, location: { hash, pathname: "/admin/", search: "", href: "https://galab.khu.ac.kr/admin/" + hash }, history: { replaceState: (...args) => history.push(args[2]) } };
  return { window, storage, values, history };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("public config rejects service-role credentials and URL credentials", () => {
  assert.equal(validateConfig(config), true);
  assert.equal(validateConfig({ ...config, publishableKey: "sb_secret_never-public" }), false);
  const serviceToken = btoa('{"alg":"HS256"}') + "." + btoa('{"role":"service_role"}') + ".signature";
  assert.equal(validateConfig({ ...config, publishableKey: serviceToken }), false);
  assert.equal(validateConfig({ ...config, supabaseUrl: "https://user:password@example.supabase.co" }), false);
  assert.equal(validateConfig({ ...config, supabaseUrl: "http://example.supabase.co" }), false);
  assert.equal(validateConfig({ ...config, functionName: "../admin" }), false);
});

test("invitation session is removed from URL and keeps password setup required", async () => {
  const env = environment({ hash: tokenFragment });
  const client = createClient(config, { ...env, fetch: async () => { throw new Error("Unexpected fetch"); } });
  assert.equal(client.isPasswordFlow(), true);
  assert.equal((await client.getSession()).access_token, "access");
  assert.deepEqual(env.history, ["/admin/"]);
  await assert.rejects(client.setPassword("short"), /12자/);
  assert.equal(client.isPasswordFlow(), true);
});

test("failed login does not create an authenticated or demo session", async () => {
  const env = environment();
  const client = createClient(config, { ...env, fetch: async () => json({ error_description: "Invalid login credentials" }, 400) });
  await assert.rejects(client.signIn("someone@example.test", "wrong"), /로그인 정보/);
  assert.equal(await client.getSession(), null);
  assert.equal(env.values.has("galab-cms-session-v1"), false);
});

test("short IDs use real password auth and never determine the server role", async () => {
  const env = environment();
  const calls = [];
  const client = createClient({ ...config, loginAccounts: { member: "members@example.test", admin: "owner@example.test" } }, {
    ...env,
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return json({ access_token: "authenticated", refresh_token: "refresh", expires_in: 3600, user: { id: "server-user" } });
    },
  });
  await client.signIn(" MEMBER ", "real-private-password");
  assert.match(calls[0].url, /grant_type=password$/);
  assert.deepEqual(calls[0].body, { email: "members@example.test", password: "real-private-password" });
  await client.signIn("admin", "owner-private-password");
  assert.deepEqual(calls[1].body, { email: "owner@example.test", password: "owner-private-password" });
  await client.signIn("invited@example.test", "individual-password");
  assert.equal(calls[2].body.email, "invited@example.test");
  await assert.rejects(client.signIn("constructor", "anything"), /아이디 또는 비밀번호/);
  assert.equal(calls.length, 3);
});

test("shared-account aliases cannot create sessions when the password is rejected", async () => {
  const env = environment();
  const client = createClient({ ...config, loginAccounts: { admin: "owner@example.test" } }, {
    ...env, fetch: async () => json({ error_description: "Invalid login credentials" }, 400),
  });
  await assert.rejects(client.signIn("admin", "admin"), /로그인 정보/);
  assert.equal(await client.getSession(), null);
  assert.equal(env.values.has("galab-cms-session-v1"), false);
  assert.equal(validateConfig({ ...config, loginAccounts: { admin: "not-an-email" } }), false);
  assert.equal(validateConfig({ ...config, loginAccounts: ["owner@example.test"] }), false);
});

test("expired sessions refresh once across concurrent requests", async () => {
  const env = environment({ savedSession: { access_token: "old", refresh_token: "refresh", expires_at: 1 } });
  let refreshes = 0;
  const client = createClient(config, { ...env, fetch: async (url, options) => {
    if (url.includes("grant_type=refresh_token")) {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return json({ access_token: "new", refresh_token: "refresh2", expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, "Bearer new");
    return json({ entries: [], profile: { role: "editor" } });
  } });
  await Promise.all([client.request("list"), client.request("list")]);
  assert.equal(refreshes, 1);
  assert.equal((await client.getSession()).access_token, "new");
});

test("forbidden approval and ambiguous publication failures are never retried", async () => {
  for (const status of [403, 503]) {
    const env = environment({ hash: tokenFragment });
    let calls = 0;
    const client = createClient(config, { ...env, fetch: async () => {
      calls++;
      return json({ code: "publishing_uncertain", message: "다시 확인해 주세요." }, status);
    } });
    await assert.rejects(client.request("approve", { id: "example", version: 1 }), /다시 확인/);
    assert.equal(calls, 1);
  }
});

test("recovery callback is sent as a URL query without leaking current tokens", async () => {
  const env = environment();
  let called;
  const client = createClient(config, { ...env, fetch: async (url, options) => { called = { url: new URL(url), options }; return json({}); } });
  await client.recoverPassword(" person@example.test ");
  assert.equal(called.url.searchParams.get("redirect_to"), "https://galab.khu.ac.kr/admin/");
  assert.deepEqual(JSON.parse(called.options.body), { email: "person@example.test" });
});

test("logout clears session even if server is temporarily unreachable", async () => {
  const env = environment({ hash: tokenFragment });
  const client = createClient(config, { ...env, fetch: async () => { throw new TypeError("Offline"); } });
  await client.signOut();
  assert.equal(await client.getSession(), null);
  assert.equal(client.isPasswordFlow(), false);
  assert.equal(env.values.has("galab-cms-session-v1"), false);
});
