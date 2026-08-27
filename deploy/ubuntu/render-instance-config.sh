#!/bin/sh
set -eu

required="ANTTODO_INSTANCE_ID ANTTODO_INSTANCE_DISPLAY_NAME ANTTODO_PUBLIC_APP_URL ANTTODO_SUPABASE_URL ANTTODO_SUPABASE_PUBLISHABLE_KEY"
for name in $required; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if ! printf '%s' "$ANTTODO_INSTANCE_ID" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'; then
  echo "ANTTODO_INSTANCE_ID must be a UUID" >&2
  exit 1
fi

if [ "${#ANTTODO_INSTANCE_DISPLAY_NAME}" -gt 80 ]; then
  echo "ANTTODO_INSTANCE_DISPLAY_NAME must be at most 80 characters" >&2
  exit 1
fi

deploy_mode="${ANTTODO_DEPLOY_MODE:-saas}"
if [ "$deploy_mode" != "saas" ] && [ "$deploy_mode" != "onPremises" ]; then
  echo "ANTTODO_DEPLOY_MODE must be saas or onPremises" >&2
  exit 1
fi

workspace_slug="${ANTTODO_INSTANCE_ENTERPRISE_SLUG:-${ANTTODO_WORKSPACE_SLUG:-}}"
if [ -n "$workspace_slug" ] && ! printf '%s' "$workspace_slug" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
  echo "ANTTODO_INSTANCE_ENTERPRISE_SLUG must contain only lowercase letters, numbers, and hyphens" >&2
  exit 1
fi
if [ "${#workspace_slug}" -gt 48 ]; then
  echo "ANTTODO_INSTANCE_ENTERPRISE_SLUG must be at most 48 characters" >&2
  exit 1
fi
if [ "$deploy_mode" = "onPremises" ] && [ -z "$workspace_slug" ]; then
  echo "ANTTODO_INSTANCE_ENTERPRISE_SLUG is required when ANTTODO_DEPLOY_MODE=onPremises" >&2
  exit 1
fi

if [ "${#ANTTODO_SUPABASE_PUBLISHABLE_KEY}" -lt 20 ] \
  || printf '%s' "$ANTTODO_SUPABASE_PUBLISHABLE_KEY" | grep -Eq '[[:space:]]' \
  || printf '%s' "$ANTTODO_SUPABASE_PUBLISHABLE_KEY" | grep -Eq '^sb_secret_'; then
  echo "ANTTODO_SUPABASE_PUBLISHABLE_KEY must be a public publishable or anon key" >&2
  exit 1
fi

for name in ANTTODO_PUBLIC_APP_URL ANTTODO_SUPABASE_URL; do
  eval "value=\${$name}"
  if ! printf '%s' "$value" | grep -Eq '^https://[^/?#]+$'; then
    echo "$name must be an HTTPS origin without a path, query, or fragment" >&2
    exit 1
  fi
  if printf '%s' "$value" | grep -Eq '[@[:space:]]'; then
    echo "$name must not contain credentials or whitespace" >&2
    exit 1
  fi
done

device_endpoint="${ANTTODO_DEVICE_AUTHORIZATION_ENDPOINT:-${ANTTODO_SUPABASE_URL%/}/functions/v1/cli-device-auth}"
expected_device_endpoint="${ANTTODO_SUPABASE_URL%/}/functions/v1/cli-device-auth"
if [ "$device_endpoint" != "$expected_device_endpoint" ]; then
  echo "ANTTODO_DEVICE_AUTHORIZATION_ENDPOINT must equal $expected_device_endpoint" >&2
  exit 1
fi

mkdir -p /tmp/anttodo-config
jq -n \
  --arg instanceId "$ANTTODO_INSTANCE_ID" \
  --arg displayName "$ANTTODO_INSTANCE_DISPLAY_NAME" \
  --arg appUrl "$ANTTODO_PUBLIC_APP_URL" \
  --arg supabaseUrl "$ANTTODO_SUPABASE_URL" \
  --arg publishableKey "$ANTTODO_SUPABASE_PUBLISHABLE_KEY" \
  --arg deviceAuthorizationEndpoint "$device_endpoint" \
  --arg deployMode "$deploy_mode" \
  --arg workspaceSlug "$workspace_slug" \
  '{schemaVersion:1,$instanceId,$displayName,deployMode:$deployMode,$appUrl,$supabaseUrl,$publishableKey,$deviceAuthorizationEndpoint,cliAuthProtocol:2} + (if $workspaceSlug == "" then {} else {workspaceSlug:$workspaceSlug} end)' \
  > /tmp/anttodo-config/anttodo.json

jq '{supabaseUrl,publishableKey,appUrl,deviceAuthorizationEndpoint,cliAuthProtocol}' \
  /tmp/anttodo-config/anttodo.json > /tmp/anttodo-config/anttodo-cli.json

chmod 0444 /tmp/anttodo-config/anttodo.json /tmp/anttodo-config/anttodo-cli.json
