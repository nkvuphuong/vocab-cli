"""POST JSON to the Apps Script web app, following its 3xx redirect by hand.

Apps Script runs doPost on the first request, caches the output and answers 302 to
script.googleusercontent.com/macros/echo, which only serves GET. So the body must
NOT be re-sent: the redirect is followed with a plain GET (urllib's default
POST->GET conversion would work too, but it also breaks on other redirect shapes).
"""

import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path

# python.org builds on macOS ship no CA path for OpenSSL; certifi already has one.
try:
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

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
    return _send(req, timeout)


def _send(req, timeout):
    opener = urllib.request.build_opener(
        _NoRedirect, urllib.request.HTTPSHandler(context=SSL_CONTEXT)
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        location = err.headers.get("Location") if err.headers else None
        if location and 300 <= err.code < 400:
            raise _Redirect(location)
        raise ApiError(f"HTTP {err.code}: {err.read()[:200]!r}") from None
    except urllib.error.URLError as err:
        raise ApiError(f"network error: {err.reason}") from None


def call(op, timeout=None, **payload):
    cfg = load_config()
    body = json.dumps({"token": cfg["token"], "op": op, **payload}).encode()
    text = None
    req = urllib.request.Request(
        cfg["endpoint"],
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    for _ in range(4):
        try:
            text = _send(req, timeout or cfg["timeout"])
            break
        except _Redirect as redirect:
            req = urllib.request.Request(redirect.location)  # GET, no body
    if text is None:
        raise ApiError("too many redirects")

    try:
        data = json.loads(text)
    except ValueError:
        raise ApiError(f"non-JSON response: {text[:200]!r}") from None
    if not data.get("ok"):
        raise ApiError(data.get("error") or "api error", data)
    return data
