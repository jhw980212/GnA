// Public connection settings only. GitHub and service-role credentials belong
// in the Supabase function's secrets, never in this file.
window.CMS_CONFIG = Object.freeze({
  supabaseUrl: "",
  publishableKey: "",
  functionName: "cms-api",
  // Optional short IDs mapped to registered Auth emails. Never put passwords here.
  loginAccounts: {},
});
