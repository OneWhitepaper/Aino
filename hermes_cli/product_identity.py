"""Read product copy from the desktop's shared, non-secret brand resource.

Distribution builders copy that resource beside this module when the desktop
sources are omitted. Protocol, command and module names are not product copy.
"""

import json
from pathlib import Path

from hermes_cli._startup_fast import project_root_str

_ROOT = Path(project_root_str())
_SOURCE_BRAND = _ROOT / "apps" / "desktop" / "brand.json"
_DATA = Path(__file__).resolve().parent / "data"
_BRAND = json.loads(
    (_SOURCE_BRAND if _SOURCE_BRAND.is_file() else _DATA / "brand.json").read_text(encoding="utf-8-sig")
)

PRODUCT_NAME = _BRAND["productName"]
AGENT_NAME = _BRAND["agentName"]
CREATOR_NAME = _BRAND["creatorName"]
COMPANY_NAME = _BRAND["companyName"]
APP_ID = _BRAND["appId"]
DOCUMENTATION_URL = _BRAND["documentationUrl"]
REPOSITORY_URL = _BRAND["repositoryUrl"]
UPSTREAM_REPOSITORY_URL = _BRAND["upstreamRepositoryUrl"]

_SOURCE_DOCS = _ROOT / "docs" / "aino"
LOCAL_DOCUMENTATION_PATH = _SOURCE_DOCS if _SOURCE_DOCS.is_dir() else _DATA / "aino-docs"
