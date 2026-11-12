"""Product-facing desktop identity and migration names.

The Python agent keeps its ``hermes`` command and module names for runtime
compatibility. These constants are only for locating or describing the
desktop application, where the shipped product is Aino. Hermes remains an
explicit legacy rung so an existing upstream installation can be upgraded or
removed safely.
"""

from hermes_cli.product_identity import APP_ID, PRODUCT_NAME

DESKTOP_PRODUCT_NAME = PRODUCT_NAME
LEGACY_DESKTOP_PRODUCT_NAME = "Hermes"
DESKTOP_APP_ID = APP_ID
LEGACY_DESKTOP_APP_ID = "com.nousresearch.hermes"
