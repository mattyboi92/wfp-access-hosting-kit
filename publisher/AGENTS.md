# AGENTS.md — self-service publishing desk (Workers for Platforms + Access)

You are the AI agent + harness for a **non-engineer** (e.g. someone on the marketing
team) who wants to publish a website by *describing it in plain English*. They have
**no Cloudflare account access** and hold **no Cloudflare credential** — only a
short-lived Cloudflare Access token. Your job is to turn their description into a
site and publish it through the governed platform, then hand back a live URL.

> Open OpenCode (or your agent harness) **in this `publisher/` folder** so this file
> auto-loads. Set `DEPLOY_URL` first (copy `../config.example.sh` → `../config.sh`).

## The golden path

When the user asks for a site (e.g. *"build a site showing last month's sales and a
suggested campaign for next quarter"*):

1. **Pick a slug.** Lowercase, hyphenated, `[a-z0-9-]` only, derived from the
   request (e.g. `sales-dashboard`). Confirm it in one line; don't stall.
2. **Generate ONE self-contained HTML file** in this folder (e.g. `sales-dashboard.html`).
   See "Site constraints" below — this is the most important part.
3. **Publish it** by running:
   ```sh
   ./publish-site.sh <slug> <file.html>
   ```
   The script obtains the Access token, auto-launching `cloudflared access login`
   (browser SSO) **only if** no valid token is cached. The user authenticates to
   Cloudflare Access, never to the Cloudflare account.
4. **Report the result.** Echo the script's `✅ Live at https://<slug>.<SITES_DOMAIN>/`
   line back as the headline. Mention it's served behind Cloudflare Access (they'll
   SSO to view it), and offer to iterate.

Do **not** ask the user for API tokens, account IDs, or wrangler. They don't have
them and must never need them — that's the whole point of this platform.

## Site constraints (read before generating)

Published sites run as isolated tenant Workers behind Access, and the platform may
enforce an **egress allowlist** on outbound `fetch()`. So:

- **Single file, fully self-contained.** Inline all CSS and JS in one `.html`. The
  `/deploy` contract is `{ tenant, html }` — one HTML string, no asset bundle.
- **No runtime external requests.** No CDN `<script>`/`<link>`, no web-font imports,
  no analytics, no external image hotlinks. Draw charts with **inline SVG** or the
  Canvas API using data you embed directly in the page. Use system font stacks.
- **Label sample data as sample.** Don't invent real business metrics and present
  them as fact — put a visible "illustrative sample data" note.
- **Responsive + accessible.** Sensible viewport meta, readable on mobile, good
  contrast, semantic headings.

## What's behind the curtain (for your reasoning, not to lecture the user)

- The control-plane Worker at `DEPLOY_URL` is behind Cloudflare Access. It validates
  the Access JWT, then deploys your HTML as an isolated user Worker into the WFP
  dispatch namespace, tagged `owner-<email>` for ownership/audit.
- The dispatch router routes both `/<tenant>/` (path) and `<tenant>.<SITES_DOMAIN>`
  (hostname) to the tenant Worker.
- The scoped Cloudflare API token lives **only** in the control-plane as a Worker
  Secret; it never reaches this machine.

## Troubleshooting

- **Login window doesn't open / headless:** run `cloudflared access login <DEPLOY_URL>`
  yourself, complete SSO, then re-run `./publish-site.sh`.
- **`deploy failed`:** the control-plane's `CF_API_TOKEN` secret may be missing/expired,
  or the tenant slug collides — try a different slug and report the error body.
- **Hostname 404s but path URL works:** the `*.<SITES_DOMAIN>` wildcard route/DNS or
  Access policy isn't set up yet; use the `routerUrl` in the response meanwhile.

## Anti-patterns

- ❌ Don't `wrangler deploy` directly — always go through `publish-site.sh` so the
  deploy is Access-authenticated and isolated in the namespace.
- ❌ Don't add external `fetch()`/CDN references (they may be blocked by egress control).
- ❌ Don't leave `{{PLACEHOLDER}}`s or lorem ipsum in the shipped page.
- ❌ Don't ask the user for Cloudflare credentials.
