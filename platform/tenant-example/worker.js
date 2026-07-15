// Tenant "user Worker". Serves the tenant's static site from the ASSETS binding.
// A "site" on this platform is just a Worker whose fetch handler returns assets.
// The x-served-by header proves which isolated Worker handled the request.
//
// This is the MULTI-FILE path (deploy with wrangler --dispatch-namespace <ns>).
// The AI/CLI publisher path (../../publisher/publish-site.sh) uses the single-file
// { tenant, html } contract instead — both land as isolated Workers in the namespace.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("x-served-by", "tenant-example (isolated user Worker)");
    return out;
  },
};
