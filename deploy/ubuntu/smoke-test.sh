#!/bin/sh
set -eu

image="${1:-anttodo-web:local}"
container="anttodo-web-smoke-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm -d \
  --name "$container" \
  -p 127.0.0.1::5000 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=101,gid=101 \
  --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=16m,uid=101,gid=101 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -e ANTTODO_INSTANCE_ID=b62e90cc-98b2-407d-bc1c-cf48b735259b \
  -e "ANTTODO_INSTANCE_DISPLAY_NAME=宇策科技 AntTodo" \
  -e ANTTODO_DEPLOY_MODE=onPremises \
  -e ANTTODO_INSTANCE_ENTERPRISE_SLUG=yucekj \
  -e ANTTODO_PUBLIC_APP_URL=https://todo.yuce-tech.cn \
  -e ANTTODO_SUPABASE_URL=https://supabase.example.com \
  -e ANTTODO_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdefghijklmnopqrstuvwxyz \
  "$image" >/dev/null

attempt=0
while [ "$attempt" -lt 30 ]; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")
  [ "$health" = "healthy" ] && break
  [ "$health" = "unhealthy" ] && {
    docker logs "$container" >&2
    exit 1
  }
  attempt=$((attempt + 1))
  sleep 1
done
[ "${health:-}" = "healthy" ] || {
  docker logs "$container" >&2
  exit 1
}

port=$(docker port "$container" 5000/tcp | sed -n '1s/.*://p')
base_url="http://127.0.0.1:$port"

[ "$(curl -fsS "$base_url/healthz")" = "ok" ]
manifest=$(curl -fsS "$base_url/.well-known/anttodo.json")
printf '%s' "$manifest" | jq -e '
  .schemaVersion == 1 and
  .displayName == "宇策科技 AntTodo" and
  .deployMode == "onPremises" and
  .workspaceSlug == "yucekj" and
  (has("custom_brand_name") | not) and
  .appUrl == "https://todo.yuce-tech.cn" and
  .supabaseUrl == "https://supabase.example.com" and
  .deviceAuthorizationEndpoint == "https://supabase.example.com/functions/v1/cli-device-auth" and
  (has("serviceRoleKey") | not) and
  (has("databasePassword") | not)
' >/dev/null
curl -fsS "$base_url/.well-known/anttodo-cli.json" | jq -e \
  '.appUrl == "https://todo.yuce-tech.cn"' >/dev/null

html_headers=$(curl -fsSI "$base_url/workspaces/deep-link" | tr -d '\r')
printf '%s\n' "$html_headers" | grep -Eiq '^Cache-Control: no-cache$'
printf '%s\n' "$html_headers" | grep -Eiq '^X-Frame-Options: SAMEORIGIN$'
manifest_headers=$(curl -fsSI "$base_url/.well-known/anttodo.json" | tr -d '\r')
printf '%s\n' "$manifest_headers" | grep -Eiq '^Access-Control-Allow-Origin: \*$'
printf '%s\n' "$manifest_headers" | grep -Eiq '^Cache-Control: no-store$'
asset_path=$(curl -fsS "$base_url/" | sed -n 's/.*src="\.\([^"?]*\/assets\/[^"?]*\.js\)".*/\1/p' | sed -n '1p')
[ -n "$asset_path" ]
asset_headers=$(curl -fsSI "$base_url$asset_path" | tr -d '\r')
printf '%s\n' "$asset_headers" | grep -Eiq '^Cache-Control: public, max-age=31536000, immutable$'

docker exec "$container" sh -c 'test "$(id -u)" = 101 && test ! -w /usr/share/nginx/html'
[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")" = "true" ]
[ "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")" = '["ALL"]' ]

echo "Ubuntu Web smoke test passed for $image"
