"""POST JSON to the Apps Script web app, following its 3xx redirect by hand.

urllib turns a POST into a GET on 301/302, which would drop the body, so the
redirect handler is disabled and the call is re-sent to the Location instead.
"""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(
    os.environ.get("VOCAB_CONFIG", "~/.config/vocab-cli/config.json")
).expanduser()


class ApiError(Exception):
    def __init__(self, message, payload=None):
        super().__init__(message)
        self.payload = payload or {}


class _Redirect(Exception):
    def __init__(self, location):
        super().__init__(location)
        self.location = location


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_config():
    cfg = {}
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text())
    endpoint = os.environ.get("VOCAB_ENDPOINT") or cfg.get("endpoint")
    token = os.environ.get("VOCAB_TOKEN") or cfg.get("token")
    if not endpoint or not token:
        raise ApiError(
            f"missing endpoint/token: create {CONFIG_PATH} (see README setup step 4)"
        )
    return {"endpoint": endpoint, "token": token, "timeout": float(cfg.get("timeout", 20))}


def _post(url, body, timeout):
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json; charset=utf-8"}
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        location = err.headers.get("Location") if err.headers else None
        if location and 300 <= err.code < 400:
            raise _Redirect(location)
        raise ApiError(f"HTTP {err.code}: {err.read()[:200]!r}") from None


def call(op, timeout=None, **payload):
    cfg = load_config()
    body = json.dumps({"token": cfg["token"], "op": op, **payload}).encode()
    url = cfg["endpoint"]
    text = None
    for _ in range(4):
        try:
            text = _post(url, body, timeout or cfg["timeout"])
            break
        except _Redirect as redirect:
            url = redirect.location
    if text is None:
        raise ApiError("too many redirects")

    try:
        data = json.loads(text)
    except ValueError:
        raise ApiError(f"non-JSON response: {text[:200]!r}") from None
    if not data.get("ok"):
        raise ApiError(data.get("error") or "api error", data)
    return data
