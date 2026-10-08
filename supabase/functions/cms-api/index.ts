import { load, JSON_SCHEMA } from "npm:js-yaml@4.1.1";
import { createHandler } from "./handler.js";

Deno.serve(createHandler({
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  CMS_ORIGIN: Deno.env.get("CMS_ORIGIN"),
  CMS_ADMIN_URL: Deno.env.get("CMS_ADMIN_URL"),
  GITHUB_TOKEN: Deno.env.get("GITHUB_TOKEN"),
  GITHUB_REPOSITORY: Deno.env.get("GITHUB_REPOSITORY") || "exphysio/GnA",
  GITHUB_BRANCH: Deno.env.get("GITHUB_BRANCH") || "main",
}, { parseYaml: (source: string) => load(source, { schema: JSON_SCHEMA }) }));
