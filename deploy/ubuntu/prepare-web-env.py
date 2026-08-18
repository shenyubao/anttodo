#!/usr/bin/env python3
"""Create the Web Compose environment from a self-hosted Supabase stack."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--supabase-env", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--workspace-slug")
    parser.add_argument("--enterprise-slug")
    parser.add_argument("--deploy-mode", default="onPremises")
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    return parser.parse_args()


def read_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip("\"'")
    return result


def validate_https_origin(value: str, name: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise SystemExit(f"{name} must be an HTTPS origin")
    return value.rstrip("/")


def main() -> None:
    args = parse_args()
    UUID(args.instance_id)
    app_url = validate_https_origin(args.app_url, "app URL")
    supabase = read_env(args.supabase_env)
    supabase_url = validate_https_origin(
        supabase["SUPABASE_PUBLIC_URL"], "Supabase public URL"
    )
    public_key = supabase.get("SUPABASE_PUBLISHABLE_KEY") or supabase.get("ANON_KEY")
    if not public_key:
        raise SystemExit("Supabase publishable/anon key is missing")
    if not 1 <= args.port <= 65535:
        raise SystemExit("port must be between 1 and 65535")
    display_name = args.display_name.strip()
    if not display_name or len(display_name) > 80:
        raise SystemExit("display name must contain 1 to 80 characters")
    deploy_mode = (args.deploy_mode or "onPremises").strip()
    if deploy_mode not in {"saas", "onPremises"}:
        raise SystemExit("deploy mode must be saas or onPremises")
    workspace_slug = (args.enterprise_slug or args.workspace_slug or "").strip()
    if workspace_slug and (
        not 2 <= len(workspace_slug) <= 48
        or not workspace_slug.isascii()
        or not all(part.isalnum() for part in workspace_slug.split("-"))
        or workspace_slug != workspace_slug.lower()
    ):
        raise SystemExit("enterprise slug must contain 2 to 48 lowercase letters, numbers, and hyphens")
    if deploy_mode == "onPremises" and not workspace_slug:
        raise SystemExit("enterprise slug is required when deploy mode is onPremises")

    values = {
        "ANTTODO_WEB_IMAGE": args.image,
        "ANTTODO_WEB_BIND": args.bind,
        "ANTTODO_WEB_PORT": str(args.port),
        "ANTTODO_INSTANCE_ID": args.instance_id,
        "ANTTODO_INSTANCE_DISPLAY_NAME": display_name,
        "ANTTODO_DEPLOY_MODE": deploy_mode,
        **({"ANTTODO_INSTANCE_ENTERPRISE_SLUG": workspace_slug} if workspace_slug else {}),
        "ANTTODO_PUBLIC_APP_URL": app_url,
        "ANTTODO_SUPABASE_URL": supabase_url,
        "ANTTODO_SUPABASE_PUBLISHABLE_KEY": public_key,
        "ANTTODO_DEVICE_AUTHORIZATION_ENDPOINT": (
            f"{supabase_url}/functions/v1/cli-device-auth"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    os.chmod(args.output, 0o600)
    print(f"Wrote {args.output} with public client configuration")


if __name__ == "__main__":
    main()
