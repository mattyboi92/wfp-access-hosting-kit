// Dynamic dispatch Worker (platform entry point) — Workers for Platforms.
//
// Routes an incoming request to the tenant's isolated user Worker in the
// dispatch namespace. This is where platform logic runs BEFORE tenant code:
// authentication, rate limiting, per-tenant custom limits, response sanitizing,
// egress control.
//
// Two dispatch modes (hostname preferred):
//   1. Hostname:  <tenant>.<SITES_DOMAIN>            -> tenant = subdomain label
//        served behind Access on the wildcard *.<SITES_DOMAIN>; path passes through.
//   2. Path:      <router-host>/<tenant>/...          -> tenant = first path segment
//        kept for the workers.dev host and backwards-compat.
//
// Var: SITES_DOMAIN (e.g. "sites.example.com"). Binding: DISPATCHER (dispatch namespace).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const suffix = "." + (env.SITES_DOMAIN || "sites.example.com").toLowerCase();

    let slug;
    let rewritten;

    if (host.endsWith(suffix)) {
      // Hostname dispatch: coffee-sales.sites.example.com -> "coffee-sales"
      slug = host.slice(0, -suffix.length);
      rewritten = new URL(request.url); // path passes through unchanged
    } else {
      // Path dispatch: /<tenant>/...
      const parts = url.pathname.split("/").filter(Boolean);
      slug = parts[0];
      if (!slug) return html(landing());
      rewritten = new URL(request.url);
      rewritten.pathname = "/" + parts.slice(1).join("/");
    }

    if (!slug || slug === "www") return html(landing());

    try {
      // Look up the tenant's user Worker in the dispatch namespace.
      const userWorker = env.DISPATCHER.get(slug);
      const res = await userWorker.fetch(new Request(rewritten, request));
      const out = new Response(res.body, res);
      out.headers.set("x-dispatched-to", slug);
      return out;
    } catch (err) {
      // .get() throws if the script does not exist in the namespace.
      if (String(err).includes("Worker not found") || String(err).includes("could not find")) {
        return html(notFound(slug), 404);
      }
      return html(`<h1>Dispatch error</h1><pre>${String(err)}</pre>`, 500);
    }
  },
};

function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function landing() {
  return `<!doctype html><meta charset="utf-8">
  <title>Platform — dispatch router</title>
  <body style="font-family:-apple-system,sans-serif;max-width:640px;margin:60px auto;padding:0 20px">
  <h1>Platform · dispatch router</h1>
  <p>Platform entry point. Requests route to isolated tenant Workers in the dispatch namespace.</p>
  <p>Tenants are reachable two ways:</p>
  <ul>
    <li>Hostname: <code>&lt;tenant&gt;.&lt;SITES_DOMAIN&gt;</code></li>
    <li>Path: <code>/&lt;tenant&gt;/</code></li>
  </ul>
  </body>`;
}

function notFound(slug) {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;margin:60px auto;max-width:640px">
  <h1>No tenant "${slug}" in namespace</h1><p><a href="/">Back</a></p></body>`;
}
