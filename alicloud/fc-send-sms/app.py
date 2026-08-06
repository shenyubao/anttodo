"""Aliyun Function Compute SMS relay for AntTodo.

Two modes on the same Flask entrypoint:

1. Supabase Send SMS Hook (Auth can point here directly)
   POST body: Standard Webhooks payload with sms.otp / phone
   Headers: webhook-id, webhook-timestamp, webhook-signature
   Env: SEND_SMS_HOOK_SECRETS + ALIYUN_* (same as production Edge Function)

2. Thin HTTPS forward (HK Edge Function cannot reach dysmsapi)
   POST JSON: {"url": "https://dysmsapi.aliyuncs.com/?...", "headers": {...}}
   Header: x-relay-secret: <ALIYUN_SMS_RELAY_SECRET>
   Env: ALIYUN_SMS_RELAY_SECRET (and optional ALIYUN_SMS_ENDPOINT for allowlist)

Credentials for mode 1 should match production Edge Function env vars.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlparse

import requests
from flask import Flask, Request, jsonify, request
from standardwebhooks.webhooks import Webhook

app = Flask(__name__)

ALGORITHM = "ACS3-HMAC-SHA256"
SIGNED_HEADERS = (
    "host;x-acs-action;x-acs-content-sha256;x-acs-date;"
    "x-acs-signature-nonce;x-acs-version"
)
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")
OTP_RE = re.compile(r"^\d{6}$")
DEFAULT_ALLOWED_HOSTS = frozenset({"dysmsapi.aliyuncs.com"})


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or not str(value).strip():
        raise RuntimeError(f"missing_{name}")
    return str(value).strip()


def optional_env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def json_error(message: str, status: int, retry: bool = False):
    headers = {"retry-after": "2"} if retry else None
    return jsonify({"error": message}), status, headers or {}


def normalize_webhook_signature(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r",\s+(?=v1,)", " ", value)


def allowed_sms_hosts() -> set[str]:
    hosts = set(DEFAULT_ALLOWED_HOSTS)
    endpoint = optional_env("ALIYUN_SMS_ENDPOINT")
    if endpoint:
        host = endpoint.replace("https://", "").replace("http://", "").strip("/")
        if host:
            hosts.add(host.split("/")[0])
    return hosts


def parse_sms_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("invalid_phone")
    sms = payload.get("sms") if isinstance(payload.get("sms"), dict) else {}
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    raw_phone = sms.get("phone", user.get("phone"))
    otp = sms.get("otp")
    if not isinstance(raw_phone, str):
        raise ValueError("invalid_phone")
    compact = re.sub(r"[\s()-]", "", raw_phone.strip())
    if compact.startswith("+86"):
        domestic = compact[3:]
    elif compact.startswith("86"):
        domestic = compact[2:]
    else:
        domestic = compact
    if not PHONE_RE.match(domestic):
        raise ValueError("invalid_phone")
    if not isinstance(otp, str) or not OTP_RE.match(otp):
        raise ValueError("invalid_otp")
    return {
        "domestic_phone": domestic,
        "otp": otp,
        "masked_phone": f"{domestic[:3]}****{domestic[-4:]}",
    }


def verify_webhook(raw_payload: str, req: Request) -> Any:
    configured = env("SEND_SMS_HOOK_SECRETS")
    headers = {key.lower(): value for key, value in req.headers.items()}
    headers["webhook-signature"] = normalize_webhook_signature(
        headers.get("webhook-signature")
    )
    last_error: Exception | None = None
    for configured_secret in configured.split("|"):
        secret = configured_secret.strip()
        if secret.startswith("v1,whsec_"):
            secret = secret[len("v1,whsec_") :]
        if not secret:
            continue
        try:
            return Webhook(secret).verify(raw_payload.encode("utf-8"), headers)
        except Exception as error:  # noqa: BLE001 - try next rotating secret
            last_error = error
    raise ValueError("invalid_webhook_signature") from last_error


def percent_encode(value: str) -> str:
    encoded = quote(value, safe="-_.~")
    return re.sub(
        r"[!'()*]",
        lambda match: f"%{ord(match.group(0)):02X}",
        encoded,
    )


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hmac_sha256_hex(secret: str, value: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def build_aliyun_sms_request(
    *,
    access_key_id: str,
    access_key_secret: str,
    endpoint: str,
    region: str,
    phone: str,
    sign_name: str,
    template_code: str,
    otp: str,
    out_id: str,
) -> tuple[str, dict[str, str]]:
    host = endpoint.replace("https://", "").replace("http://", "").strip("/")
    parameters = {
        "OutId": out_id,
        "PhoneNumbers": phone,
        "RegionId": region,
        "SignName": sign_name,
        "TemplateCode": template_code,
        "TemplateParam": json.dumps({"code": otp}, separators=(",", ":")),
    }
    canonical_query = "&".join(
        f"{percent_encode(key)}={percent_encode(value)}"
        for key, value in sorted(parameters.items(), key=lambda item: item[0])
    )
    payload_hash = sha256_hex("")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nonce = str(uuid.uuid4())
    signed_header_values = {
        "host": host,
        "x-acs-action": "SendSms",
        "x-acs-content-sha256": payload_hash,
        "x-acs-date": date,
        "x-acs-signature-nonce": nonce,
        "x-acs-version": "2017-05-25",
    }
    canonical_headers = "\n".join(
        f"{name}:{signed_header_values[name]}" for name in SIGNED_HEADERS.split(";")
    )
    canonical_request = "\n".join(
        [
            "POST",
            "/",
            canonical_query,
            canonical_headers,
            "",
            SIGNED_HEADERS,
            payload_hash,
        ]
    )
    string_to_sign = f"{ALGORITHM}\n{sha256_hex(canonical_request)}"
    signature = hmac_sha256_hex(access_key_secret, string_to_sign)
    headers = {
        **signed_header_values,
        "Authorization": (
            f"{ALGORITHM} Credential={access_key_id},"
            f"SignedHeaders={SIGNED_HEADERS},Signature={signature}"
        ),
    }
    return f"https://{host}/?{canonical_query}", headers


def aliyun_error_status(code: str | None) -> int:
    rate_limit = {
        "isv.BUSINESS_LIMIT_CONTROL",
        "isv.DAY_LIMIT_CONTROL",
        "Throttling",
        "Throttling.User",
    }
    permanent = {
        "isv.INVALID_PARAMETERS",
        "isv.INVALID_TEMPLATE",
        "isv.SMS_SIGNATURE_ILLEGAL",
        "isv.SMS_TEMPLATE_ILLEGAL",
        "InvalidAccessKeyId.NotFound",
        "SignatureDoesNotMatch",
    }
    if code in rate_limit:
        return 429
    if code in permanent:
        return 500
    return 503


def handle_relay(body: dict[str, Any]):
    expected = optional_env("ALIYUN_SMS_RELAY_SECRET") or optional_env(
        "RELAY_SHARED_SECRET"
    )
    provided = request.headers.get("x-relay-secret", "").strip()
    if not expected or provided != expected:
        return json_error("Unauthorized", 401)

    url = body.get("url")
    headers = body.get("headers")
    if not isinstance(url, str) or not isinstance(headers, dict):
        return json_error("Invalid relay request", 400)

    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return json_error("Host not allowed", 400)
    if parsed.hostname not in allowed_sms_hosts():
        return json_error("Host not allowed", 400)

    forward_headers = {
        str(key): str(value)
        for key, value in headers.items()
        if str(key).lower() != "content-length"
    }
    try:
        response = requests.post(url, headers=forward_headers, timeout=4)
    except requests.RequestException as error:
        print(f"relay_upstream_error: {error}")
        return json_error("SMS provider unavailable", 503, retry=True)

    content_type = response.headers.get("Content-Type", "application/json")
    return response.text, response.status_code, {"Content-Type": content_type}


def handle_sms_hook(raw_payload: bytes):
    webhook_id = request.headers.get("webhook-id") or "unknown"
    try:
        verified = verify_webhook(raw_payload.decode("utf-8"), request)
        sms = parse_sms_payload(verified)
        url, headers = build_aliyun_sms_request(
            access_key_id=env("ALIYUN_APIKEY"),
            access_key_secret=env("ALIYUN_SECRETKEY"),
            endpoint=env("ALIYUN_SMS_ENDPOINT", "dysmsapi.aliyuncs.com"),
            region=env("ALIYUN_REGION", "cn-hangzhou"),
            phone=sms["domestic_phone"],
            sign_name=env("ALIYUN_SMS_SIGN_NAME"),
            template_code=env("ALIYUN_SMS_TEMPLATE_CODE"),
            otp=sms["otp"],
            out_id=webhook_id,
        )
        provider = requests.post(url, headers=headers, timeout=4)
        payload = provider.json() if provider.content else {}
        code = payload.get("Code") or payload.get("code")
        if not provider.ok or code != "OK":
            status = aliyun_error_status(code if isinstance(code, str) else None)
            print(
                "Aliyun SMS rejected request",
                {
                    "webhookId": webhook_id,
                    "phone": sms["masked_phone"],
                    "code": code or "unknown",
                },
            )
            return json_error(
                "SMS rate limited" if status == 429 else "SMS provider unavailable",
                status,
                retry=status in (429, 503),
            )
        print(
            "Aliyun SMS accepted request",
            {
                "webhookId": webhook_id,
                "phone": sms["masked_phone"],
                "requestId": payload.get("RequestId")
                or payload.get("requestId")
                or "unknown",
            },
        )
        return jsonify({})
    except ValueError as error:
        code = str(error)
        invalid_signature = code == "invalid_webhook_signature"
        invalid_payload = code in {"invalid_phone", "invalid_otp"}
        print(
            "Send SMS hook failed",
            {
                "webhookId": webhook_id,
                "category": code
                if invalid_signature or invalid_payload
                else "internal_error",
            },
        )
        return json_error(
            "Invalid hook request"
            if invalid_signature or invalid_payload
            else "SMS provider unavailable",
            401 if invalid_signature else 422 if invalid_payload else 503,
            retry=not invalid_signature and not invalid_payload,
        )
    except Exception as error:  # noqa: BLE001
        print(
            "Send SMS hook failed",
            {"webhookId": webhook_id, "category": "internal_error", "error": str(error)},
        )
        return json_error("SMS provider unavailable", 503, retry=True)


@app.route("/", defaults={"path": ""}, methods=["GET", "POST", "PUT", "DELETE"])
@app.route("/<path:path>", methods=["GET", "POST", "PUT", "DELETE"])
def entry(path: str):
    if request.method == "GET":
        return jsonify({"ok": True, "service": "anttodo-fc-send-sms", "path": path})

    if request.method != "POST":
        return json_error("Method not allowed", 405)

    raw = request.get_data(cache=True)
    body = request.get_json(silent=True)

    # Thin forward used by HK Edge Function when dysmsapi is unreachable.
    if isinstance(body, dict) and "url" in body and "headers" in body:
        return handle_relay(body)

    return handle_sms_hook(raw)


if __name__ == "__main__":
    # Aliyun FC custom runtime / HTTP trigger listens on 9000.
    app.run(host="0.0.0.0", port=9000)
