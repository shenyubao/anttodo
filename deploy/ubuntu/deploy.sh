#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

compose() {
  docker compose --env-file .env -f compose.yaml "$@"
}

if [ ! -f .env ]; then
  echo "Missing deploy/ubuntu/.env; copy .env.example and fill the instance values." >&2
  exit 1
fi

compose config --quiet
container_id=$(compose ps -q web)
previous_image=""
if [ -n "$container_id" ]; then
  previous_image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  previous_image=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$previous_image_id" 2>/dev/null || true)
fi
if [ -n "$previous_image" ]; then
  printf '%s\n' "$previous_image" > .previous-image
fi

compose pull web
configured_image=$(compose config --images | sed -n '1p')
resolved_image=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$configured_image" 2>/dev/null || true)
echo "Deploying ${resolved_image:-configured image}"
compose up -d --remove-orphans

attempt=0
while [ "$attempt" -lt 30 ]; do
  container_id=$(compose ps -q web)
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
  if [ "$health" = "healthy" ]; then
    echo "AntTodo Web is healthy on port 5000."
    exit 0
  fi
  if [ "$health" = "unhealthy" ] || [ "$health" = "exited" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "Health check failed." >&2
if [ -n "$previous_image" ]; then
  echo "Rolling back to $previous_image" >&2
  ANTTODO_WEB_IMAGE="$previous_image" compose up -d --remove-orphans
fi
exit 1
