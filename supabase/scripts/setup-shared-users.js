#!/usr/bin/env node
// Run locally with service credentials. This file must never be served by the website.
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

class SetupError extends Error {}
const stop = message => { throw new SetupError(message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function parseEnvFile(source) {
  const values = {};
  for (const [index, raw] of source.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || Object.hasOwn(values, match[1])) stop(`Invalid or duplicate environment setting on line ${index + 1}.`);
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      // Values are literal: no expansion, escape processing, or shell evaluation.
      if (value.length < 2 || !value.endsWith(quote) || value.slice(1, -1).includes(quote)) stop(`Invalid quoted environment setting on line ${index + 1}.`);
      value = value.slice(1, -1);
    } else if (/\s/.test(value)) {
      stop(`Quote environment values containing spaces on line ${index + 1}.`);
    }
    if (["__proto__", "constructor", "prototype"].includes(match[1])) stop(`Invalid environment key on line ${index + 1}.`);
    values[match[1]] = value;
  }
  return values;
}

function settings(env) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { stop("SUPABASE_URL is required and must be a valid project URL."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    stop("Use an HTTPS Supabase project origin; HTTP is allowed only for localhost.");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || !key.trim()) stop("SUPABASE_SERVICE_ROLE_KEY is required for local account setup.");
  const account = (kind, role) => {
    const prefix = `CMS_${kind.toUpperCase()}`;
    const email = env[`${prefix}_EMAIL`]?.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) stop(`${prefix}_EMAIL must contain a valid internal Auth email address.`);
    const password = env[`${prefix}_PASSWORD`];
    if (typeof password !== "string" || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password))
      stop(`${prefix}_PASSWORD needs 12–128 characters, with no newlines or null characters.`);
    const displayName = env[`${prefix}_DISPLAY_NAME`] || (role === "admin" ? "홈페이지 관리자" : "연구실 구성원");
    if (displayName.length > 100 || /[<>\0]/.test(displayName)) stop(`${prefix}_DISPLAY_NAME is invalid.`);
    return { kind, email, password, role, displayName };
  };
  const owner = account("owner", "admin"), member = account("member", "editor");
  if (owner.email === member.email) stop("Owner and member must use different internal Auth email addresses.");
  if (owner.password === member.password) stop("Owner and member must use different passwords so members cannot approve their own posts.");
  return { url: url.origin, key, accounts: [owner, member] };
}

export async function setupSharedUsers(env, { fetch: fetcher = globalThis.fetch, resetPasswords = false } = {}) {
  const config = settings(env);
  async function request(path, method = "GET", body) {
    let response;
    try {
      response = await fetcher(`${config.url}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { stop("Supabase request failed. Check the project connection; account setup may be partially complete."); }
    if (!response.ok) stop(`Supabase rejected account setup (HTTP ${response.status}). Check server credentials and apply the CMS migration first.`);
    try { return response.status === 204 ? null : await response.json(); }
    catch { stop("Supabase returned an invalid response. Account setup may be partially complete."); }
  }
  async function profileFor(user) {
    const rows = await request(`/rest/v1/cms_profiles?id=eq.${user.id}&select=id,email,display_name,role,active&limit=1`);
    const profile = rows?.[0];
    if (!profile || !["admin", "editor"].includes(profile.role) || typeof profile.active !== "boolean" || profile.email?.trim().toLowerCase() !== user.email?.trim().toLowerCase())
      stop("An Auth account has no matching CMS profile. Apply the migration and verify the account before rerunning.");
    return profile;
  }

  // Verify the schema BEFORE creating any accounts. Only select protected role fields.
  const preflight = await request("/rest/v1/cms_profiles?select=id,role,active&limit=1");
  if (!Array.isArray(preflight)) stop("The CMS migration must be applied before account setup.");
  const wanted = new Map(config.accounts.map(account => [account.email, account]));
  const existing = new Map();
  for (let page = 1; page <= 1000; page++) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=100`);
    if (!Array.isArray(result?.users)) stop("Supabase returned an invalid Auth user list.");
    for (const user of result.users) {
      const email = user.email?.trim().toLowerCase();
      if (!wanted.has(email)) continue;
      if (!UUID.test(user.id) || existing.has(email)) stop("An internal Auth email has an invalid or duplicate account; verify it in Supabase first.");
      existing.set(email, user);
    }
    if (existing.size === wanted.size) break;
    const next = Number(result.next_page);
    if ((Number.isFinite(next) && next > page) || result.users.length === 100) {
      if (page === 1000) stop("Too many Auth users to safely complete this setup. No new accounts were created.");
      continue;
    }
    break;
  }

  // Check ALL reused accounts before any writes. In particular, never silently promote
  // an existing editor to owner, or demote an existing administrator to shared member.
  const plan = [];
  for (const account of config.accounts) {
    const user = existing.get(account.email);
    const profile = user ? await profileFor(user) : null;
    if (profile && profile.role !== account.role)
      stop(`Existing ${account.kind} account has a different CMS role. Refusing to change its privileges; verify the account in Supabase first.`);
    plan.push({ account, user, profile, created: false });
  }

  const results = [];
  for (const item of plan) {
    const { account } = item;
    if (!item.user) {
      const result = await request("/auth/v1/admin/users", "POST", {
        email: account.email, password: account.password, email_confirm: true,
        user_metadata: { display_name: account.displayName },
      });
      item.user = result?.user || result;
      if (!UUID.test(item.user?.id) || item.user?.email?.trim().toLowerCase() !== account.email)
        stop("Supabase did not confirm the requested new account. Verify partial setup before rerunning.");
      item.created = true;
      item.profile = await profileFor(item.user);
      // The migration always creates an inactive editor. Promote only an account
      // created by THIS run, never one found by an email lookup on a later run.
      if (item.profile.role !== "editor" || item.profile.active)
        stop("New account profile has unexpected privileges. Verify it before activating shared login.");
    } else if (resetPasswords) {
      await request(`/auth/v1/admin/users/${item.user.id}`, "PUT", { password: account.password, email_confirm: true });
    }
    if (item.created || !item.profile.active) {
      const rows = await request(`/rest/v1/cms_profiles?id=eq.${item.user.id}&role=eq.${item.profile.role}&active=eq.${item.profile.active}`, "PATCH", {
        role: account.role, active: true,
        ...(!item.profile.display_name ? { display_name: account.displayName } : {}),
      });
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== item.user.id || rows[0].role !== account.role || rows[0].active !== true)
        stop("CMS profile changed during setup. No unchecked role change was applied; verify partial setup before rerunning.");
    }
    results.push({ account: account.kind, role: account.role, created: item.created, active: true, passwordChanged: item.created || resetPasswords });
  }
  // No passwords, emails, access tokens, or Auth IDs are returned/logged.
  return results;
}

async function main(argv) {
  let filename;
  let resetPasswords = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--env-file" && !filename && argv[index + 1]) filename = argv[++index];
    else if (argv[index] === "--reset-passwords" && !resetPasswords) resetPasswords = true;
    else if (argv[index] === "--help") {
      process.stdout.write("Usage: node supabase/scripts/setup-shared-users.js [--env-file <gitignored-file>] [--reset-passwords]\nReads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CMS_OWNER_EMAIL/PASSWORD and CMS_MEMBER_EMAIL/PASSWORD.\nExisting passwords are retained unless --reset-passwords is explicitly supplied.\n");
      return;
    } else stop("Unknown or incomplete setup option. Use --help; never pass credentials on the command line.");
  }
  let env = process.env;
  if (filename) {
    const path = resolve(process.cwd(), filename);
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", path], { cwd: WORKSPACE, windowsHide: true });
    if (ignored.status !== 0) stop("The credentials file must be ignored by this repository. Put it inside .preview/ and rerun.");
    let source;
    try { source = await readFile(path, "utf8"); } catch { stop("Could not read the ignored credentials file."); }
    env = { ...process.env, ...parseEnvFile(source) };
  }
  const results = await setupSharedUsers(env, { resetPasswords });
  for (const result of results) process.stdout.write(`${result.account}: ${result.created ? "created" : "reused"}; ${result.role}, active; ${result.passwordChanged ? "password set" : "existing password retained"}.\n`);
  process.stdout.write("Shared CMS accounts are ready. No invitation email was sent.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof SetupError ? error.message : "Account setup failed. Verify partial setup before rerunning."}\n`);
    process.exitCode = 1;
  });
}
