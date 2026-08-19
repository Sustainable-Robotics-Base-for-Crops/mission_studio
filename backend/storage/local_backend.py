"""
Local storage backend used by default in the public repo.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional


class LocalStorageBackend:
    """
    Local filesystem storage implementation.
    """

    name = "local"

    def __init__(self, uploads_dir: str):
        self.uploads_dir = uploads_dir
        os.makedirs(self.uploads_dir, exist_ok=True)

    def save(self, filepath: str, data: str) -> bool:
        try:
            full_path = os.path.join(self.uploads_dir, filepath)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as handle:
                handle.write(data)
            return True
        except Exception:
            return False

    def load(self, filepath: str) -> Optional[str]:
        try:
            full_path = os.path.join(self.uploads_dir, filepath)
            if not os.path.exists(full_path):
                return None
            with open(full_path, "r", encoding="utf-8") as handle:
                return handle.read()
        except Exception:
            return None

    def delete(self, filepath: str) -> bool:
        try:
            full_path = os.path.join(self.uploads_dir, filepath)
            if not os.path.exists(full_path):
                return False
            os.remove(full_path)
            return True
        except Exception:
            return False

    def list(self, metadata_only: bool = False) -> List[Dict[str, Any]]:
        files: List[Dict[str, Any]] = []
        if not os.path.exists(self.uploads_dir):
            return files

        for root, _dirs, filenames in os.walk(self.uploads_dir):
            for filename in filenames:
                if not filename.endswith(".json"):
                    continue
                full_path = os.path.join(root, filename)
                rel_parent = os.path.relpath(root, self.uploads_dir)
                rel_path = os.path.join(rel_parent, filename).replace("\\", "/")
                stat = os.stat(full_path)
                row: Dict[str, Any] = {
                    "filename": filename,
                    "fullPath": rel_path,
                    "storage": "local",
                    "size": stat.st_size,
                    "lastModified": stat.st_mtime * 1000,
                }
                if not metadata_only:
                    try:
                        with open(full_path, "r", encoding="utf-8") as handle:
                            import json

                            content = json.load(handle)
                        row.update(content)
                    except Exception:
                        # Corrupted file: at least return the metadata.
                        pass
                files.append(row)
        return files
