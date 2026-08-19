"""
Shared application runtime for both HTTP servers.

The legacy ``http.server`` handler and the FastAPI app (L5a) must assemble the
same providers, controllers and HTML service. Construction lives here so the
flag ``BACKEND_FASTAPI`` only switches the transport.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from backend.auth.anonymous import AnonymousAuthProvider
from backend.config.settings import Settings
from backend.controllers.trajectory_controller import TrajectoryController
from backend.core.app_factory import AppFactory
from backend.core.extension_points import AppContext
from backend.db import Database
from backend.equipment import EquipmentRepository
from backend.fields import FieldRepository
from backend.jobs import JobQueue
from backend.middleware.auth_middleware import AuthMiddleware
from backend.middleware.rate_limit_middleware import RateLimitMiddleware
from backend.middleware.validation_middleware import ValidationMiddleware
from backend.repositories.trajectory_repository import TrajectoryRepository
from backend.services.geocoding_service import GeocodingService
from backend.services.html_generation_service import HtmlGenerationService
from backend.services.trajectory_service import TrajectoryService
from backend.services.validation_service import ValidationService

logger = logging.getLogger("trajectory_editor")


@dataclass
class EditorRuntime:
    context: AppContext
    trajectory_controller: TrajectoryController
    auth_middleware: AuthMiddleware
    html_generation_service: HtmlGenerationService
    geocoding_service: GeocodingService
    auth_required: bool
    database: Database | None = None
    job_queue: JobQueue | None = None
    fields: FieldRepository | None = None
    equipment: EquipmentRepository | None = None

    @classmethod
    def build(cls, sqlite_path: str | None = None) -> EditorRuntime:
        Settings.ensure_directories()
        context = AppFactory.build(Settings, logger)
        auth_required = not isinstance(context.auth_provider, AnonymousAuthProvider)
        validation_service = ValidationService()
        geocoding_service = GeocodingService(Settings)
        validation_middleware = ValidationMiddleware(validation_service)
        trajectory_repository = TrajectoryRepository(context.storage_backends)
        trajectory_service = TrajectoryService(trajectory_repository, validation_service)
        trajectory_controller = TrajectoryController(
            trajectory_service=trajectory_service,
            validation_middleware=validation_middleware,
            permission_provider=context.permission_provider,
        )
        auth_middleware = AuthMiddleware(
            auth_provider=context.auth_provider,
            rate_limit_middleware=RateLimitMiddleware(),
            anonymous_mode=not auth_required,
        )
        html_generation_service = HtmlGenerationService(
            permission_provider=context.permission_provider,
            templates_dirs=[Settings.TEMPLATES_DIR, *context.template_dirs],
            template_slots=context.template_slots,
        )
        database = None
        job_queue = None
        fields = None
        equipment = None
        if sqlite_path:
            database = Database(sqlite_path)
            job_queue = JobQueue(database)
            fields = FieldRepository(database)
            equipment = EquipmentRepository(database)
        return cls(
            context=context,
            trajectory_controller=trajectory_controller,
            auth_middleware=auth_middleware,
            html_generation_service=html_generation_service,
            geocoding_service=geocoding_service,
            auth_required=auth_required,
            database=database,
            job_queue=job_queue,
            fields=fields,
            equipment=equipment,
        )
