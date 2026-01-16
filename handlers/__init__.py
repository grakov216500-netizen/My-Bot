# handlers/__init__.py
# Просто чтобы избежать багов с импортами

from .registration import get_registration_handler
from .profile import profile_router, get_profile_edit_handler
from .admin import admin_router
# и т.д.
