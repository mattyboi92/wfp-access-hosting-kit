// CONTROL-PLANE (deployer) — protected by Cloudflare Access.
//
// Cloudflare Access sits in front of this Worker's hostname and authenticates
// every user (OTP, Okta, or your IdP) BEFORE the request arrives. Access injects
// a signed JWT in the `Cf-Access-Jwt-Assertion` header. This Worker validates
// that JWT (defense-in-depth) and reads the caller's identity, then deploys the
// site as an isolated user Worker in the Workers-for-Platforms dispatch namespace.
//
// The end user never holds a Cloudflare credential:
//   - they authenticate to Cloudflare Access (via `cloudflared access login`)
//   - the scoped Cloudflare API token lives only here, as a Worker Secret
//
// Vars:    ACCOUNT_ID, NAMESPACE, ROUTER_URL, SITES_DOMAIN, TEAM_DOMAIN, ACCESS_AUD
// Secrets: CF_API_TOKEN   (Workers Scripts: Edit + Workers for Platforms — server-side only)

let JWKS_CACHE = { keys: null, at: 0 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, cf-access-jwt-assertion",
      "access-control-allow-methods": "POST, GET, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/deploy" && request.method === "POST") {
        // 1) AUTHENTICATE via the Cloudflare Access JWT (no custom tokens).
        const identity = await verifyAccessJwt(request, env);
        if (!identity.ok) {
          return json({ error: "unauthorized", reason: identity.error }, 401, cors);
        }

        // 2) AUTHORIZE + derive tenant. Identity (email / IdP groups) comes from
        //    the Access JWT claims — a real platform maps these to a tenant/role.
        const body = await request.json().catch(() => ({}));
        const slug = (body.tenant || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
        const html = body.html;
        if (!slug || !html) return json({ error: "tenant and html are required" }, 400, cors);

        // 3) DEPLOY into the WFP dispatch namespace using the SERVER-SIDE token.
        const workerCode =
          `export default { async fetch() { return new Response(${JSON.stringify(html)}, ` +
          `{ headers: { "content-type": "text/html; charset=utf-8", "x-served-by": "${slug} (isolated user Worker)" } }); } };`;

        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify({
          main_module: "index.mjs",
          tags: [`tenant-${slug}`, `owner-${identity.email}`],
        })], { type: "application/json" }));
        form.append("index.mjs", new Blob([workerCode], { type: "application/javascript+module" }), "index.mjs");

        const api = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/workers/dispatch/namespaces/${env.NAMESPACE}/scripts/${slug}`;
        const put = await fetch(api, {
          method: "PUT",
          headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
          body: form,
        });
        const putRes = await put.json();
        if (!putRes.success) return json({ error: "deploy failed", detail: putRes.errors }, 502, cors);

        // Prefer the clean per-tenant hostname (served behind Access on the
        // *.SITES_DOMAIN wildcard route); fall back to the path-based router URL.
        const siteUrl = env.SITES_DOMAIN
          ? `https://${slug}.${env.SITES_DOMAIN}/`
          : `${env.ROUTER_URL}/${slug}/`;

        return json({
          ok: true,
          deployedBy: identity.email,
          tenant: slug,
          url: siteUrl,
          routerUrl: `${env.ROUTER_URL}/${slug}/`,
          message: `Live at ${siteUrl}`,
          note: "Deployed as an isolated user Worker in the WFP dispatch namespace. User authenticated via Cloudflare Access and never touched the Cloudflare account.",
        }, 200, cors);
      }

      // Public info endpoint (still behind Access at the edge).
      return json({
        service: "control-plane",
        auth: "Cloudflare Access (OTP / Okta / your IdP)",
        deploy: "POST /deploy  { tenant, html }  (Access-authenticated)",
      }, 200, cors);
    } catch (err) {
      return json({ error: String(err) }, 500, cors);
    }
  },
};

// ── Cloudflare Access JWT validation ─────────────────────────────────────────
async function verifyAccessJwt(request, env) {
  if (!env.TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: false, error: "control-plane not yet configured with TEAM_DOMAIN/ACCESS_AUD" };
  }
  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    getCookie(request, "CF_Authorization");
  if (!token) return { ok: false, error: "missing Access JWT (run `cloudflared access login`)" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed JWT" };
  const [h, p, s] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToText(h));
    payload = JSON.parse(b64urlToText(p));
  } catch {
    return { ok: false, error: "unparseable JWT" };
  }

  // Claims: audience, issuer, expiry.
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, error: "aud mismatch" };
  if (payload.iss !== `https://${env.TEAM_DOMAIN}`) return { ok: false, error: "iss mismatch" };
  if (payload.exp && Date.now() / 1000 > payload.exp) return { ok: false, error: "token expired" };

  // Signature (RS256) against the Access JWKS.
  const jwk = (await getJwks(env)).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, error: "signing key not found" };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`)
  );
  if (!valid) return { ok: false, error: "bad signature" };

  return { ok: true, email: payload.email || "unknown", groups: payload.groups || [] };
}

async function getJwks(env) {
  if (JWKS_CACHE.keys && Date.now() - JWKS_CACHE.at < 3600_000) return JWKS_CACHE.keys;
  const res = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`);
  const data = await res.json();
  JWKS_CACHE = { keys: data.keys || [], at: Date.now() };
  return JWKS_CACHE.keys;
}

function getCookie(request, name) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}
function b64urlToText(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { "content-type": "application/json", ...extra },
  });
}
