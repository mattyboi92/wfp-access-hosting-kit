#!/bin/bash
# publish-site.sh — publish a single-file static site to the platform through
# Cloudflare Access + Workers for Platforms.
#
#   Usage: ./publish-site.sh <tenant-slug> <path-to-html-file>
#
# The caller never holds a Cloudflare credential — only a short-lived Cloudflare
# Access token. If no valid Access token is cached, this script launches
# `cloudflared access login` automatically (browser SSO: OTP / Okta / your IdP).
#
# Config: set DEPLOY_URL (the Access-protected control-plane hostname) either in
# ../config.sh (copy ../config.example.sh) or as an environment variable.
set -euo pipefail

CURL=/usr/bin/curl
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Load config.sh from the kit root if present (DEPLOY_URL, etc.)
[ -f "$HERE/../config.sh" ] && . "$HERE/../config.sh"

APP="${DEPLOY_URL:-}"
if [ -z "$APP" ]; then
  echo "✗ DEPLOY_URL is not set. Copy config.example.sh -> config.sh and set your" >&2
  echo "  control-plane hostname (e.g. DEPLOY_URL=https://deploy.example.com)." >&2
  exit 2
fi

TENANT="${1:-}"
FILE="${2:-}"
if [ -z "$TENANT" ] || [ -z "$FILE" ]; then
  echo "usage: $0 <tenant-slug> <file.html>" >&2
  exit 2
fi
[ -f "$FILE" ] || { echo "file not found: $FILE" >&2; exit 1; }

# Normalise the slug the same way the control-plane does.
SLUG=$(printf '%s' "$TENANT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
[ -n "$SLUG" ] || { echo "tenant slug is empty after normalisation" >&2; exit 1; }

# 1) Ensure we have an Access token; auto-login if not.
get_token() { cloudflared access token -app="$APP" 2>/dev/null || true; }
TOKEN=$(get_token)
if [ -z "$TOKEN" ] || printf '%s' "$TOKEN" | grep -qi "unable to find token"; then
  echo "→ No Cloudflare Access token cached. Launching login…" >&2
  cloudflared access login "$APP"
  TOKEN=$(get_token)
fi
if [ -z "$TOKEN" ] || printf '%s' "$TOKEN" | grep -qi "unable to find token"; then
  echo "✗ Could not obtain an Access token. Run:  cloudflared access login $APP" >&2
  exit 1
fi

# 2) Build the JSON payload (html as a JSON string) and POST /deploy.
PAYLOAD=$(HTML_FILE="$FILE" SLUG="$SLUG" python3 - <<'PY'
import json, os
html = open(os.environ["HTML_FILE"], encoding="utf-8").read()
print(json.dumps({"tenant": os.environ["SLUG"], "html": html}))
PY
)

RESP=$("$CURL" -s -X POST "$APP/deploy" \
  -H "cf-access-token: $TOKEN" \
  -H "content-type: application/json" \
  --data-binary "$PAYLOAD")

# 3) Pretty-print the response and surface the friendly Live-at line.
printf '%s\n' "$RESP" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$RESP"

URL=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("url",""))' 2>/dev/null || true)
if [ -n "$URL" ]; then
  echo
  echo "✅ Live at $URL"
else
  echo
  echo "✗ Deploy did not return a URL — see the response above." >&2
  exit 1
fi
