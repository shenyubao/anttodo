#!/usr/bin/env python3
"""Configure an existing self-hosted Supabase stack for AntTodo.

This script is intentionally conservative: it backs up the two files it edits,
keeps existing secrets, and only generates instance-local secrets when they are
missing. It never prints secret values.
"""

from __future__ import annotations

import argparse
import base64
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path


FUNCTION_ENVIRONMENT = """      PUBLIC_APP_URL: ${PUBLIC_APP_URL}
      SSO_STATE_SECRET: ${SSO_STATE_SECRET}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      VAPID_SUBJECT: ${VAPID_SUBJECT}
      REMINDER_DISPATCH_SECRET: ${REMINDER_DISPATCH_SECRET}
      REMINDER_ACK_SECRET: ${REMINDER_ACK_SECRET}
      INIT_APP_ADMIN_MOBILE: ${init_app_admin_mobile:-}
      INIT_APP_ADMIN_SECRET: ${INIT_APP_ADMIN_SECRET:-}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
      DEEPSEEK_BASE_URL: ${DEEPSEEK_BASE_URL:-}
      DEEPSEEK_MODEL: ${DEEPSEEK_MODEL:-}
      SEND_SMS_HOOK_SECRETS: ${SEND_SMS_HOOK_SECRETS:-}
      ALIYUN_APIKEY: ${ALIYUN_APIKEY:-}
      ALIYUN_SECRETKEY: ${ALIYUN_SECRETKEY:-}
      ALIYUN_REGION: ${ALIYUN_REGION:-}
      ALIYUN_SMS_ENDPOINT: ${ALIYUN_SMS_ENDPOINT:-}
      ALIYUN_SMS_SIGN_NAME: ${ALIYUN_SMS_SIGN_NAME:-}
      ALIYUN_SMS_TEMPLATE_CODE: ${ALIYUN_SMS_TEMPLATE_CODE:-}
      ALIYUN_SMS_RELAY_URL: ${ALIYUN_SMS_RELAY_URL:-}
      ALIYUN_SMS_RELAY_BEARER: ${ALIYUN_SMS_RELAY_BEARER:-}"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--docker-dir",
        type=Path,
        default=Path("/root/apps/supabase/docker"),
        help="Directory containing the self-hosted Supabase .env and compose file",
    )
    parser.add_argument("--app-url", required=True)
    parser.add_argument(
        "--vapid-subject", default="mailto:notifications@yuce-tech.cn"
    )
    return parser.parse_args()


def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text().splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
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
        result.append("# AntTodo independent-instance configuration")
        result.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(result) + "\n"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def generate_vapid_pair() -> tuple[str, str]:
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError as exc:  # pragma: no cover - deployment environment check
        raise SystemExit("python cryptography package is required for VAPID keys") from exc

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_number = private_key.private_numbers().private_value.to_bytes(32, "big")
    public_numbers = private_key.public_key().public_numbers()
    public_key = (
        b"\x04"
        + public_numbers.x.to_bytes(32, "big")
        + public_numbers.y.to_bytes(32, "big")
    )
    return b64url(public_key), b64url(private_number)


def ensure_function_environment(compose: str) -> str:
    # @supabase/server requires a named default public key. Keep the existing
    # self-hosted stack in legacy-key mode until operators explicitly migrate
    # the whole stack to asymmetric signing and opaque sb_publishable_* keys.
    compose = compose.replace(
        '      SUPABASE_PUBLISHABLE_KEYS: "{\\"default\\":\\"${SUPABASE_PUBLISHABLE_KEY:-}\\"}"',
        '      SUPABASE_PUBLISHABLE_KEYS: "{\\"default\\":\\"${ANON_KEY}\\"}"',
    )
    compose = compose.replace(
        '      SUPABASE_SECRET_KEYS: "{\\"default\\":\\"${SUPABASE_SECRET_KEY:-}\\"}"',
        '      SUPABASE_SECRET_KEYS: "{\\"default\\":\\"${SERVICE_ROLE_KEY}\\"}"',
    )
    marker = '      VERIFY_JWT: "${FUNCTIONS_VERIFY_JWT}"'
    if "      PUBLIC_APP_URL: ${PUBLIC_APP_URL}" in compose:
        return compose
    if compose.count(marker) != 1:
        raise SystemExit("unable to locate the functions environment insertion point")
    return compose.replace(marker, f"{marker}\n{FUNCTION_ENVIRONMENT}")


def main() -> None:
    args = parse_args()
    env_path = args.docker_dir / ".env"
    compose_path = args.docker_dir / "docker-compose.yml"
    if not env_path.is_file() or not compose_path.is_file():
        raise SystemExit(f"Supabase files not found below {args.docker_dir}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    env_backup = env_path.with_name(f".env.anttodo-backup-{timestamp}")
    compose_backup = compose_path.with_name(
        f"docker-compose.yml.anttodo-backup-{timestamp}"
    )
    shutil.copy2(env_path, env_backup)
    shutil.copy2(compose_path, compose_backup)

    lines, existing = read_env(env_path)
    updates = {
        "SITE_URL": args.app_url,
        "ADDITIONAL_REDIRECT_URLS": f"{args.app_url}/**,anttodo://auth/callback",
        "PUBLIC_APP_URL": args.app_url,
        "SSO_STATE_SECRET": existing.get("SSO_STATE_SECRET")
        or secrets.token_urlsafe(48),
        "REMINDER_DISPATCH_SECRET": existing.get("REMINDER_DISPATCH_SECRET")
        or secrets.token_urlsafe(48),
        "REMINDER_ACK_SECRET": existing.get("REMINDER_ACK_SECRET")
        or secrets.token_urlsafe(48),
        "VAPID_SUBJECT": existing.get("VAPID_SUBJECT") or args.vapid_subject,
    }
    if existing.get("VAPID_PUBLIC_KEY") and existing.get("VAPID_PRIVATE_KEY"):
        updates["VAPID_PUBLIC_KEY"] = existing["VAPID_PUBLIC_KEY"]
        updates["VAPID_PRIVATE_KEY"] = existing["VAPID_PRIVATE_KEY"]
    else:
        public_key, private_key = generate_vapid_pair()
        updates["VAPID_PUBLIC_KEY"] = public_key
        updates["VAPID_PRIVATE_KEY"] = private_key

    env_path.write_text(upsert_env(lines, updates))
    compose_path.write_text(ensure_function_environment(compose_path.read_text()))

    print(f"Backed up .env to {env_backup.name}")
    print(f"Backed up docker-compose.yml to {compose_backup.name}")
    print("Configured AntTodo Auth redirects and Edge Function environment")
    print("Generated missing instance secrets without displaying their values")


if __name__ == "__main__":
    main()
