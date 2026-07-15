#!/bin/bash
# setup-wildcard-hostnames.sh — ONE-TIME platform setup so every tenant is
# reachable at <tenant>.<SITES_DOMAIN> through the dispatch router.
#
# After this runs once, NO per-deploy hostname work is needed — the wildcard
# route + wildcard DNS record cover all current and future tenants.
#
# Requires a Cloudflare API token with, on your zone:
#   • DNS: Edit            (to create the proxied wildcard record)
#   • Workers Routes: Edit (to bind *.<SITES_DOMAIN>/* to the router)
# NOTE: the control-plane's scoped CF_API_TOKEN intentionally does NOT need these
# perms. Use a separate elevated token here — this is one-time infra setup, not the
# runtime path. You can also do both steps in the dashboard (see QUICKSTART.md).
#
#   Usage:
#     ZONE_NAME=example.com SITES_DOMAIN=sites.example.com ROUTER_SCRIPT=dispatch-router \
#       CLOUDFLARE_API_TOKEN=... ./setup-wildcard-hostnames.sh
set -euo pipefail

CURL=/usr/bin/curl
API="https://api.cloudflare.com/client/v4"
: "${ZONE_NAME:?set ZONE_NAME (e.g. example.com)}"
: "${SITES_DOMAIN:?set SITES_DOMAIN (e.g. sites.example.com)}"
ROUTER_SCRIPT="${ROUTER_SCRIPT:-dispatch-router}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (needs DNS:Edit + Workers Routes:Edit on ${ZONE_NAME})}"

WILDCARD="*.${SITES_DOMAIN}"
# subdomain label(s) under the zone, e.g. sites.example.com in example.com -> "sites"
SUB_LABEL="${SITES_DOMAIN%.$ZONE_NAME}"
DNS_NAME="*.${SUB_LABEL}"
AUTH=(-H "authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "content-type: application/json")

echo "→ Looking up zone id for ${ZONE_NAME}…"
ZONE_ID=$("$CURL" -s "${AUTH[@]}" "${API}/zones?name=${ZONE_NAME}" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r["result"][0]["id"] if r.get("result") else "")')
[ -n "$ZONE_ID" ] || { echo "✗ could not resolve zone id (token perms?)" >&2; exit 1; }
echo "   zone id: $ZONE_ID"

echo "→ Ensuring proxied wildcard DNS record ${DNS_NAME}.${ZONE_NAME}…"
EXISTING=$("$CURL" -s "${AUTH[@]}" "${API}/zones/${ZONE_ID}/dns_records?type=A&name=${DNS_NAME}.${ZONE_NAME}" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r["result"][0]["id"] if r.get("result") else "")')
DNS_BODY=$(printf '{"type":"A","name":"%s","content":"192.0.2.1","proxied":true,"comment":"WFP tenant wildcard -> dispatch router"}' "$DNS_NAME")
if [ -n "$EXISTING" ]; then
  "$CURL" -s "${AUTH[@]}" -X PUT "${API}/zones/${ZONE_ID}/dns_records/${EXISTING}" --data "$DNS_BODY" >/dev/null
  echo "   updated existing record"
else
  "$CURL" -s "${AUTH[@]}" -X POST "${API}/zones/${ZONE_ID}/dns_records" --data "$DNS_BODY" >/dev/null
  echo "   created record"
fi

echo "→ Ensuring Worker route ${WILDCARD}/* -> ${ROUTER_SCRIPT}…"
ROUTE_BODY=$(printf '{"pattern":"%s/*","script":"%s"}' "$WILDCARD" "$ROUTER_SCRIPT")
RES=$("$CURL" -s "${AUTH[@]}" -X POST "${API}/zones/${ZONE_ID}/workers/routes" --data "$ROUTE_BODY")
if printf '%s' "$RES" | grep -q '"success":true'; then
  echo "   route created"
elif printf '%s' "$RES" | grep -qi "already exists\|duplicate"; then
  echo "   route already exists (ok)"
else
  echo "   route response: $RES"
fi

cat <<EOF

✔ Wildcard wiring done. Remaining MANUAL step (dashboard):
   Zero Trust → Access → Applications → Add a self-hosted app on '${WILDCARD}'
   with your IdP policy (e.g. Okta + One-Time PIN). Then visiting
   <tenant>.${SITES_DOMAIN} prompts SSO and serves the tenant's isolated Worker.
EOF
