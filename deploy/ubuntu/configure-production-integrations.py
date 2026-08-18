#!/usr/bin/env python3
"""Configure production AI and Aliyun SMS secrets without echoing them.

The configuration payload is read as one JSON object from stdin. Before files
are changed, the script uses Aliyun's read-only GetSmsTemplate API to validate
the credentials and derive the approved sign associated with the template.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


DOCKER_DIR = Path("/root/apps/supabase/docker")
ENV_PATH = DOCKER_DIR / ".env"
COMPOSE_PATH = DOCKER_DIR / "docker-compose.yml"


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
        result.append("# AntTodo production integrations")
        result.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(result) + "\n"


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def aliyun_request(
    access_key_id: str,
    access_key_secret: str,
    endpoint: str,
    action: str,
    parameters: dict[str, str],
) -> dict[str, object]:
    algorithm = "ACS3-HMAC-SHA256"
    signed_headers = ";".join(
        [
            "host",
            "x-acs-action",
            "x-acs-content-sha256",
            "x-acs-date",
            "x-acs-signature-nonce",
            "x-acs-version",
        ]
    )
    query = urllib.parse.urlencode(
        sorted(parameters.items()), quote_via=urllib.parse.quote, safe="-_.~"
    )
    payload_hash = sha256(b"")
    headers = {
        "host": endpoint,
        "x-acs-action": action,
        "x-acs-content-sha256": payload_hash,
        "x-acs-date": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "x-acs-signature-nonce": str(uuid.uuid4()),
        "x-acs-version": "2017-05-25",
    }
    canonical_headers = "\n".join(
        f"{name}:{headers[name]}" for name in signed_headers.split(";")
    )
    canonical_request = "\n".join(
        ["POST", "/", query, canonical_headers, "", signed_headers, payload_hash]
    )
    string_to_sign = f"{algorithm}\n{sha256(canonical_request.encode())}"
    signature = hmac.new(
        access_key_secret.encode(), string_to_sign.encode(), hashlib.sha256
    ).hexdigest()
    headers["Authorization"] = (
        f"{algorithm} Credential={access_key_id},"
        f"SignedHeaders={signed_headers},Signature={signature}"
    )
    request = urllib.request.Request(
        f"https://{endpoint}/?{query}", data=b"", headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            body = json.load(error)
            code = body.get("Code", f"HTTP_{error.code}")
            message = body.get("Message", "Aliyun API request failed")
        except Exception:
            code = f"HTTP_{error.code}"
            message = "Aliyun API request failed"
        raise SystemExit(f"Aliyun {action} failed: {code}: {message}") from error


def require(payload: dict[str, object], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"missing configuration field: {name}")
    if "\n" in value or "\r" in value:
        raise SystemExit(f"invalid line break in configuration field: {name}")
    return value.strip()


def configure_auth_hook(compose: str) -> str:
    replacements = {
        '      # GOTRUE_HOOK_SEND_SMS_ENABLED: "false"': (
            '      GOTRUE_HOOK_SEND_SMS_ENABLED: "true"'
        ),
        '      # GOTRUE_HOOK_SEND_SMS_URI: "pg-functions://postgres/public/custom_access_token_hook"': (
            "      GOTRUE_HOOK_SEND_SMS_URI: "
            '"${SUPABASE_PUBLIC_URL}/functions/v1/send-sms"'
        ),
        '      # GOTRUE_HOOK_SEND_SMS_SECRETS: "v1,whsec_VGhpcyBpcyBhbiBleGFtcGxlIG9mIGEgc2hvcnRlciBCYXNlNjQgc3RyaW5n"': (
            "      GOTRUE_HOOK_SEND_SMS_SECRETS: ${SEND_SMS_HOOK_SECRETS}"
        ),
    }
    for old, new in replacements.items():
        if new in compose:
            continue
        if compose.count(old) != 1:
            raise SystemExit(f"unable to configure Auth hook at: {old.strip()}")
        compose = compose.replace(old, new)
    return compose


def main() -> None:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise SystemExit("configuration payload must be a JSON object")

    deepseek_key = require(payload, "deepseekApiKey")
    access_key_id = require(payload, "aliyunAccessKeyId")
    access_key_secret = require(payload, "aliyunAccessKeySecret")
    region = require(payload, "aliyunRegion")
    endpoint = require(payload, "aliyunEndpoint")
    template_code = require(payload, "aliyunTemplateCode")
    if not deepseek_key.startswith("sk-"):
        raise SystemExit("DeepSeek API key has an unexpected format")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", endpoint):
        raise SystemExit("Aliyun endpoint must be a hostname")
    if not re.fullmatch(r"SMS_[0-9]+", template_code):
        raise SystemExit("Aliyun template code has an unexpected format")

    template = aliyun_request(
        access_key_id,
        access_key_secret,
        endpoint,
        "GetSmsTemplate",
        {"TemplateCode": template_code},
    )
    if template.get("Code") != "OK":
        raise SystemExit(
            f"Aliyun GetSmsTemplate failed: {template.get('Code', 'unknown')}"
        )
    if str(template.get("TemplateStatus")) != "1":
        raise SystemExit("Aliyun SMS template is not approved")
    if str(template.get("TemplateType")) != "0":
        raise SystemExit("Aliyun SMS template is not a verification-code template")
    template_content = str(template.get("TemplateContent", ""))
    if "${code}" not in template_content:
        raise SystemExit("Aliyun SMS template must contain the ${code} variable")
    sign_name = str(template.get("RelatedSignName", "")).strip()
    if not sign_name:
        raise SystemExit("Aliyun SMS template does not have a related sign name")

    lines, existing = read_env(ENV_PATH)
    hook_secret = existing.get("SEND_SMS_HOOK_SECRETS") or (
        "v1,whsec_" + base64.b64encode(secrets.token_bytes(32)).decode()
    )
    updates = {
        "DEEPSEEK_API_KEY": deepseek_key,
        "ALIYUN_APIKEY": access_key_id,
        "ALIYUN_SECRETKEY": access_key_secret,
        "ALIYUN_REGION": region,
        "ALIYUN_SMS_ENDPOINT": endpoint,
        "ALIYUN_SMS_SIGN_NAME": sign_name,
        "ALIYUN_SMS_TEMPLATE_CODE": template_code,
        "SEND_SMS_HOOK_SECRETS": hook_secret,
    }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    env_backup = ENV_PATH.with_name(f".env.integrations-backup-{timestamp}")
    compose_backup = COMPOSE_PATH.with_name(
        f"docker-compose.yml.integrations-backup-{timestamp}"
    )
    shutil.copy2(ENV_PATH, env_backup)
    shutil.copy2(COMPOSE_PATH, compose_backup)
    ENV_PATH.write_text(upsert_env(lines, updates))
    os.chmod(ENV_PATH, 0o600)
    COMPOSE_PATH.write_text(configure_auth_hook(COMPOSE_PATH.read_text()))

    print(f"Validated approved Aliyun template and related sign: {sign_name}")
    print("Configured DeepSeek, Aliyun SMS, and the signed Auth SMS hook")
    print(f"Backed up .env to {env_backup.name}")
    print(f"Backed up docker-compose.yml to {compose_backup.name}")


if __name__ == "__main__":
    main()
