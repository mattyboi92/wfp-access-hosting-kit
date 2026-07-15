# QUICKSTART — deploy the platform and publish your first site

~20 minutes. Replace `example.com` / `sites.example.com` / `your-team` with your own
values throughout. Commands assume `wrangler` (v3+) and `cloudflared` are installed.

---

## Phase 0 — Prerequisites

- A Cloudflare account with the **Workers for Platforms** add-on enabled.
- **Cloudflare Access** (Zero Trust) enabled, with an IdP configured (e.g. Okta) and/or
  One-Time PIN. Note your team domain: `your-team.cloudflareaccess.com`.
- A zone on the account (e.g. `example.com`) — Access apps require a real zone
  (workers.dev is not Access-eligible). Pick a sites subdomain, e.g. `sites.example.com`.
- Tooling: `node` (or `bun`), `wrangler`, and `cloudflared`.
- `wrangler login` (or `export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...`).

---

## Phase 1 — Create the dispatch namespace

```sh
wrangler dispatch-namespace create production
```
Use any name; if not `production`, update `NAMESPACE` in both wrangler configs and the
`dispatch_namespaces[].namespace` in the router config.

---

## Phase 2 — Deploy the dispatch router

Edit `platform/dispatch-router/wrangler.jsonc`:
- `vars.SITES_DOMAIN` → `sites.example.com`
- `dispatch_namespaces[0].namespace` → your namespace name

```sh
cd platform/dispatch-router
wrangler deploy
```
Note the deployed URL (e.g. `https://dispatch-router.<your-subdomain>.workers.dev`).

Deploy a test tenant to prove routing:
```sh
cd ../tenant-example
wrangler deploy --dispatch-namespace production        # script name "tenant-example" = the slug
curl -s https://dispatch-router.<your-subdomain>.workers.dev/tenant-example/ | head
```

---

## Phase 3 — Control-plane: token, secret, custom domain, Access app

**3a. Create a scoped API token** (dash → My Profile → API Tokens → Create Token):
- Permissions: **Account → Workers Scripts → Edit** and **Account → Workers for Platforms → Edit**
  (nothing else). This is the only token the platform holds.

**3b. Configure and deploy the control-plane.** Edit `platform/control-plane/wrangler.jsonc`:
- `ACCOUNT_ID`, `NAMESPACE`, `ROUTER_URL` (from Phase 2), `SITES_DOMAIN`,
  `TEAM_DOMAIN` = `your-team.cloudflareaccess.com`. Leave `ACCESS_AUD` for step 3d.

```sh
cd ../control-plane
printf '%s' '<scoped-token-from-3a>' | wrangler secret put CF_API_TOKEN
wrangler deploy
```

**3c. Give it a custom hostname** so users hit `deploy.example.com`:
- Dash → Workers & Pages → the control-plane Worker → **Domains & Routes → Add → Custom domain**
  → `deploy.example.com`.

**3d. Front it with Cloudflare Access** (Zero Trust → Access → Applications → Add → Self-hosted):
- Application domain: `deploy.example.com`
- Policy: allow your IdP (Okta) and/or One-Time PIN, scoped to the right group.
- After saving, open the app's settings and copy the **Application Audience (AUD) tag**
  (a 64-hex string — *not* the app/policy ID). Put it in `wrangler.jsonc` as `ACCESS_AUD`
  and redeploy:
```sh
wrangler deploy
```

Verify the edge blocks unauthenticated deploys (should be `302` to login):
```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://deploy.example.com/deploy
```

---

## Phase 4 — Wildcard hostnames for tenants (`<slug>.sites.example.com`)

You need three things. The first two can be scripted or done in the dash; the third is
an Access app.

**4a + 4b — wildcard DNS + Worker route.** Either run:
```sh
cd ../   # platform/
ZONE_NAME=example.com SITES_DOMAIN=sites.example.com ROUTER_SCRIPT=dispatch-router \
  CLOUDFLARE_API_TOKEN=<token-with-DNS:Edit+Workers-Routes:Edit> ./setup-wildcard-hostnames.sh
```
…or do it in the dashboard:
- **DNS → Records → Add**: type `A`, name `*.sites`, IPv4 `192.0.2.1` (placeholder —
  the Worker route intercepts), **Proxied (orange cloud ON)**.
- **Workers & Pages → dispatch-router → Domains & Routes → Add → Route**: zone `example.com`,
  route `*.sites.example.com/*`.

> The control-plane's scoped token intentionally lacks DNS/Routes perms — use a separate
> elevated token for this one-time setup, or just use the dashboard.

**4c — Access app on the wildcard.** Zero Trust → Access → Applications → Add self-hosted
app on `*.sites.example.com` with your IdP policy. (SSO means users who logged in for the
deploy app won't be re-prompted, but this app still enforces its own policy + audit.)

Verify (behind Access, `302` unauthenticated = success):
```sh
curl -s -o /dev/null -w "%{http_code}\n" https://tenant-example.sites.example.com/
```

---

## Phase 5 — Publish a site

**5a. Point the publisher at your control-plane:**
```sh
cd ..                 # kit root
cp config.example.sh config.sh
# edit config.sh: DEPLOY_URL=https://deploy.example.com  (and SITES_DOMAIN)
```

**5b. CLI publish** (one command; auto-logs in via Access the first time):
```sh
cd publisher
./publish-site.sh my-first-site examples/coffee-campaign.html
# -> ✅ Live at https://my-first-site.sites.example.com/
```

**5c. AI-agent publish (the self-service story):**
Open your agent harness (e.g. opencode) **in the `publisher/` folder** so `AGENTS.md`
loads, then say:
> *"Build a site showing last month's sales and a suggested campaign for next quarter."*

The agent generates one self-contained HTML file and runs `publish-site.sh` for you,
returning the live URL. The user only ever authenticates to Cloudflare Access.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `unauthorized / aud mismatch` | `ACCESS_AUD` is wrong — use the app's **Audience tag**, not the app/policy ID; redeploy the control-plane. |
| `deploy failed` | `CF_API_TOKEN` secret missing/expired or under-scoped; or the slug collides — try another slug. |
| Hostname 404/000 but `/<slug>/` path works | Wildcard DNS/route or the `*.sites` Access app isn't set up (Phase 4). Use the `routerUrl` meanwhile. |
| `cloudflared` login won't open a browser | Run `cloudflared access login https://deploy.example.com` manually, then re-run the publish. |
| First `wrangler deploy` prints only a banner | Known flaky first-run — just retry 2–3×. |
