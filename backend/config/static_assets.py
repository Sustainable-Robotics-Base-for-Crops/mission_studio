"""Cache policy for the Studio bundle.

Vite writes ``public/studio/assets/studio.{js,css}`` under a stable name, so a
browser that caches it keeps serving the previous build after ``npm run build``.
Those two files must be revalidated; the hashed fonts next to them may not.
The shell also stamps their URLs with the build mtime, so a cached copy cannot
survive a rebuild even when the browser ignores the revalidation headers.
"""

from __future__ import annotations

import os

from .settings import Settings

REVALIDATED_ASSETS = ("studio.js", "studio.css")


def studio_asset_headers(basename: str) -> dict[str, str] | None:
    if basename not in REVALIDATED_ASSETS:
        return None
    return {"Cache-Control": "no-cache, must-revalidate"}


def studio_build_version() -> str:
    """Identifies the current build: the newest mtime across the bundle files."""
    newest = 0.0
    for name in REVALIDATED_ASSETS:
        path = os.path.join(Settings.WEB_ROOT, "studio", "assets", name)
        try:
            newest = max(newest, os.path.getmtime(path))
        except OSError:
            continue
    return str(int(newest))
