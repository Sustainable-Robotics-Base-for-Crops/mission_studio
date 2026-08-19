"""JSON responses matching the http.server contract (UTF-8, plugin cookies)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class Utf8JSONResponse(JSONResponse):
    """Starlette defaults to ensure_ascii=True; the legacy server does not."""

    def render(self, content: Any) -> bytes:
        return json.dumps(content, ensure_ascii=False).encode("utf-8")


def handler_headers(request: Request) -> dict[str, str]:
    """
    Auth and trajectory controllers look up title-case keys
    (``Authorization``, ``Cookie``, ``X-Storage-Mode``). Starlette lowercases.
    """
    return {
        "Authorization": request.headers.get("authorization", ""),
        "Cookie": request.headers.get("cookie", ""),
        "Content-Type": request.headers.get("content-type", ""),
        "Content-Length": request.headers.get("content-length", "0"),
        "X-Storage-Mode": request.headers.get("x-storage-mode", "local"),
    }


def query_lists(request: Request) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for key, value in request.query_params.multi_items():
        result.setdefault(key, []).append(value)
    return result


def client_address(request: Request) -> tuple[str, int]:
    if request.client is None:
        return ("127.0.0.1", 0)
    return (request.client.host, request.client.port)


def json_from_handler(status: int, data: Any) -> Utf8JSONResponse:
    headers: dict[str, str] = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
    }
    payload = data
    if isinstance(data, dict):
        payload = dict(data)
        set_cookie = payload.pop("setCookie", None)
        delete_cookie = payload.pop("deleteCookie", None)
        if set_cookie:
            headers["Set-Cookie"] = str(set_cookie)
        if delete_cookie:
            headers["Set-Cookie"] = str(delete_cookie)
    return Utf8JSONResponse(payload, status_code=status, headers=headers)
