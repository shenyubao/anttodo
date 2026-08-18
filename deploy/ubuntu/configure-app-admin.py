#!/usr/bin/env python3
"""Add the idempotent AntTodo app-admin bootstrap to self-hosted Supabase."""

from __future__ import annotations

import argparse
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path


FUNCTION_ENVIRONMENT = """      INIT_APP_ADMIN_MOBILE: ${init_app_admin_mobile:?required}
      INIT_APP_ADMIN_SECRET: ${INIT_APP_ADMIN_SECRET:?required}"""

BOOTSTRAP_SERVICE = """  app-admin-bootstrap:
    image: curlimages/curl:8.12.1
    restart: "no"
    depends_on:
      functions:
        condition: service_healthy
    environment:
      INIT_APP_ADMIN_MOBILE: ${init_app_admin_mobile:?required}
      INIT_APP_ADMIN_SECRET: ${INIT_APP_ADMIN_SECRET:?required}
    command:
      - sh
      - -ec
      - |
          curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 2 \\
            -H 'content-type: application/json' \\
            -H "x-init-app-admin-secret: $${INIT_APP_ADMIN_SECRET}" \\
            --data "{\\"mobile\\":\\"$${INIT_APP_ADMIN_MOBILE}\\"}" \\
            http://api-gw:8000/functions/v1/init-app-admin

"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docker-dir", type=Path, default=Path("/root/apps/supabase/docker"))
    parser.add_argument("--mobile", required=True)
    return parser.parse_args()


def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text().splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if line and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return lines, values


def upsert_env(lines: list[str], updates: dict[str, str]) -> str:
    remaining = dict(updates)
    result: list[str] = []
    for line in lines:
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
        if match and match.group(1) in remaining:
            key = match.group(1)
            result.append(f"{key}={remaining.pop(key)}")
        else:
            result.append(line)
    if remaining:
        if result and result[-1]:
            result.append("")
        result.append("# AntTodo app-admin bootstrap")
        result.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(result) + "\n"


def ensure_functions_env(compose: str) -> str:
    marker = '      VERIFY_JWT: "${FUNCTIONS_VERIFY_JWT}"'
    if "      INIT_APP_ADMIN_MOBILE:" not in compose:
        if compose.count(marker) != 1:
            raise SystemExit("functions environment insertion point not found")
        compose = compose.replace(marker, f"{marker}\n{FUNCTION_ENVIRONMENT}")
    return compose


def ensure_bootstrap_service(compose: str) -> str:
    if "  app-admin-bootstrap:" in compose:
        return compose
    marker = "  # Comment out everything below this point if you are using an external Postgres database"
    if compose.count(marker) != 1:
        raise SystemExit("database service insertion point not found")
    return compose.replace(marker, BOOTSTRAP_SERVICE + marker)


def main() -> None:
    args = parse_args()
    mobile = re.sub(r"\D", "", args.mobile)
    if not re.fullmatch(r"1[3-9]\d{9}", mobile):
        raise SystemExit("--mobile must be an 11-digit mainland mobile number")
    env_path = args.docker_dir / ".env"
    compose_path = args.docker_dir / "docker-compose.yml"
    lines, existing = read_env(env_path)
    updates = {
        "init_app_admin_mobile": mobile,
        "INIT_APP_ADMIN_SECRET": existing.get("INIT_APP_ADMIN_SECRET")
        or secrets.token_urlsafe(48),
    }
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    shutil.copy2(env_path, env_path.with_name(f".env.app-admin-backup-{timestamp}"))
    shutil.copy2(
        compose_path,
        compose_path.with_name(f"docker-compose.yml.app-admin-backup-{timestamp}"),
    )
    env_path.write_text(upsert_env(lines, updates))
    env_path.chmod(0o600)
    compose = ensure_bootstrap_service(ensure_functions_env(compose_path.read_text()))
    compose_path.write_text(compose)
    print("Configured init_app_admin_mobile and idempotent startup bootstrap")
    print("Generated or preserved the private bootstrap secret without displaying it")


if __name__ == "__main__":
    main()
