"""The upstream Hermes contract implemented by this Aino source tree.

Plugin admission uses this version in source clones and packaged builds alike.
It is independent of Aino's release/display version and install-stamp provenance:
missing upstream Git tags, an old source stamp, or a calendar version cannot
lower or inflate the API available to plugins. Update both values only when the
corresponding official release has actually been merged into this source tree.
"""

UPSTREAM_VERSION = "0.23.0"
UPSTREAM_COMMIT = "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19"
