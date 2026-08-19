"""
Global constants for the application
"""

# Maximum upload file size (100MB)
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB in bytes

# Rate limiting
RATE_LIMIT_API_MAX_ATTEMPTS = 20  # Max attempts for API routes
RATE_LIMIT_API_WINDOW = 60  # Time window for API (1 minute in seconds)
RATE_LIMIT_DEFAULT_MAX_ATTEMPTS = 5  # Default max attempts
RATE_LIMIT_DEFAULT_WINDOW = 300  # Default time window (5 minutes in seconds)

# GPS coordinates - Validation boundaries
LATITUDE_MIN = -90
LATITUDE_MAX = 90
LONGITUDE_MIN = -180
LONGITUDE_MAX = 180
ALTITUDE_MIN = -1000
ALTITUDE_MAX = 10000

# Speed - Validation boundaries (in m/s)
SPEED_MIN = 0
SPEED_MAX = 50

# Session cookie
SESSION_COOKIE_EXPIRES_IN = 432000  # 5 days in seconds (5 * 24 * 60 * 60)

# Supported trajectory versions
SUPPORTED_TRAJECTORY_VERSIONS = ['3', '2.1', '2.0']
