# Copy this file to  config.sh  and fill in your values.
# config.sh is sourced by publisher/publish-site.sh (and is gitignored).

# The Access-protected control-plane hostname (users SSO here; deploys POST here).
export DEPLOY_URL="https://deploy.example.com"

# The wildcard sites domain — published tenants live at <slug>.<SITES_DOMAIN>.
# (Informational for humans; the live URL is returned by the control-plane.)
export SITES_DOMAIN="sites.example.com"
