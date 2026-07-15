# Self-Service Static Hosting Kit — Cloudflare Access + Workers for Platforms

Let non-engineers publish static sites — by describing them to an AI agent or via a
one-line CLI — **without ever giving them access to your Cloudflare account**, with
**per-site isolation** and a clean **ownership / audit** model.

This kit is a working reference implementation you can drop in, configure with your
own account/domain, and deploy. It has three moving parts plus an AI/CLI publisher.

---

## What you'll build

![Architecture](diagrams/architecture.svg)

| Component | What it is | Folder |
|---|---|---|
| **Dispatch router** | Platform entry point. Routes `<tenant>.sites.example.com` (hostname) and `/<tenant>/` (path) to the tenant's isolated Worker. Where you run auth, rate limits, custom limits, and egress control *before* tenant code. | `platform/dispatch-router/` |
| **Control-plane** | Deployer behind **Cloudflare Access**. Validates the Access JWT, then deploys the user's site as an **isolated user Worker** into the Workers-for-Platforms dispatch namespace, tagged `owner-<email>`. | `platform/control-plane/` |
| **Tenant Workers** | Each published site = its own isolated Worker (own isolate, own cache, no peer access) inside one dispatch namespace. Unlimited tenants. | `platform/tenant-example/` |
| **Publisher (AI/CLI)** | `publish-site.sh` + `AGENTS.md`. A non-engineer describes a site in English; the agent generates one self-contained HTML file and publishes it. Auto-runs `cloudflared access login` if needed. | `publisher/` |

---

## How a publish works

![Publish flow](diagrams/publish-flow.svg)

1. A non-engineer (optionally via an AI agent) describes the site.
2. `publish-site.sh` gets a short-lived **Cloudflare Access token** (auto-launches
   `cloudflared access login` — SSO via your IdP — only if none is cached).
3. Cloudflare Access authenticates the user at the edge and injects a signed JWT.
4. The control-plane validates the JWT (`aud`/`iss`/`exp`/RS256), then calls the
   Workers for Platforms API with its **server-side scoped token** to deploy the site.
5. The site is live at `https://<slug>.sites.example.com/` (served behind Access).

**The end user never holds a Cloudflare credential.** The one scoped API token lives
only inside the control-plane as a Worker Secret and never leaves the platform.

---

## Why this model

- **Isolation** — user Workers run untrusted; no shared cache, no peer access. One
  dispatch namespace scales to thousands of tenants.
- **No credential sprawl** — users authenticate to **Cloudflare Access** (Okta, OTP,
  or your IdP), not to the Cloudflare account. One scoped token, server-side only.
- **Governance before tenant code** — the dispatch router is the choke point for auth,
  rate/CPU limits, and egress control, applied *before* any tenant code runs.
- **Ownership & escalation** — every deploy is stamped with the caller's Access
  identity (`owner-<email>`) for a clean audit trail and one-call teardown by tag.
- **Single sign-on, per-app policy** — one IdP login can cover both the deploy app and
  the `*.sites.example.com` sites, while each Access application keeps its **own policy
  and its own per-audience session** (independent authorization and audit per app).

---

## Get started

See **[QUICKSTART.md](QUICKSTART.md)** — ~20 minutes end to end. In short:

1. Prereqs: Workers for Platforms add-on, Cloudflare Access (Zero Trust), a zone,
   `node`/`bun` + `wrangler`, and `cloudflared`.
2. Create a dispatch namespace, deploy the router and control-plane.
3. Put a scoped API token in the control-plane secret; front the control-plane with
   an Access app; wire the `*.sites.example.com` wildcard.
4. `cp config.example.sh config.sh`, fill it in, and publish your first site.

## Repo layout
```
wfp-access-hosting-kit/
├── README.md                     ← you are here
├── QUICKSTART.md                 ← step-by-step setup
├── config.example.sh             ← copy to config.sh, set DEPLOY_URL
├── platform/
│   ├── control-plane/            ← Access-protected deployer (Worker)
│   ├── dispatch-router/          ← hostname + path dispatch (Worker)
│   ├── tenant-example/           ← a multi-file tenant site (Worker + assets)
│   └── setup-wildcard-hostnames.sh
├── publisher/
│   ├── AGENTS.md                 ← teaches the AI agent the publish loop
│   ├── publish-site.sh           ← the one command that publishes a site
│   └── examples/coffee-campaign.html
└── diagrams/
    ├── architecture.svg
    ├── publish-flow.svg
    └── _build_diagrams.py        ← regenerate publish-flow.svg
```

## Accelerators (if you'd rather not hand-roll)
- **Workers for Platforms Starter Kit** (`worker-publisher-template`) — dispatch
  namespace + dispatch Worker + deploy endpoint, close to this kit's platform half.
- **VibeSDK** (https://github.com/cloudflare/vibesdk) — Cloudflare's open-source
  "describe it, AI builds + deploys it" platform. Closest to the AI publisher half.
