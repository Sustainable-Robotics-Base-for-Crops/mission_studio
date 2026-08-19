"""
Extension points exposed to private plugins.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from ..auth.anonymous import AnonymousAuthProvider
from ..permissions.open import OpenPermissionProvider
from ..storage.base import StorageBackend


RouteHandler = Callable[..., Tuple[int, dict]]


@dataclass
class AppContext:
    """
    Shared runtime container between the public core and plugins.
    """

    settings: object
    log: logging.Logger
    auth_provider: object = field(default_factory=AnonymousAuthProvider)
    permission_provider: object = field(default_factory=OpenPermissionProvider)
    storage_backends: Dict[str, StorageBackend] = field(default_factory=dict)
    extra_routes: Dict[Tuple[str, str], RouteHandler] = field(default_factory=dict)
    template_dirs: List[str] = field(default_factory=list)
    static_dirs: Dict[str, str] = field(default_factory=dict)
    template_slots: Dict[str, List[str]] = field(default_factory=dict)

    def set_auth_provider(self, provider: object) -> None:
        self.auth_provider = provider
        self.log.info("[plugins] Auth provider injected: %s", provider.__class__.__name__)

    def set_permission_provider(self, provider: object) -> None:
        self.permission_provider = provider
        self.log.info("[plugins] Permission provider injected: %s", provider.__class__.__name__)

    def register_storage_backend(self, name: str, backend: StorageBackend) -> None:
        self.storage_backends[name] = backend
        self.log.info("[plugins] Storage backend registered: %s", name)

    def register_route(self, method: str, path: str, handler: RouteHandler) -> None:
        key = (method.upper(), path)
        self.extra_routes[key] = handler
        self.log.info("[plugins] Route registered: %s %s", method.upper(), path)

    def register_template_dir(self, path: str) -> None:
        if path not in self.template_dirs:
            self.template_dirs.append(path)

    def register_static_dir(self, prefix: str, path: str) -> None:
        self.static_dirs[prefix.rstrip("/")] = path

    def register_template_partial(self, slot: str, partial_name: str) -> None:
        entries = self.template_slots.setdefault(slot, [])
        entries.append(partial_name)

    def get_slot_partials(self, slot: str) -> List[str]:
        return self.template_slots.get(slot, [])
