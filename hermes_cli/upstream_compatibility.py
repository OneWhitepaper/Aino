"""The upstream Hermes contract implemented by this Aino source tree.

Plugin admission uses this version in source clones and packaged builds alike.
It is independent of Aino's release/display version and install-stamp provenance:
missing upstream Git tags, an old source stamp, or a calendar version cannot
lower or inflate the API available to plugins. Update both values only when the
corresponding official release has actually been merged into this source tree.
"""

UPSTREAM_VERSION = "0.23.2"
UPSTREAM_COMMIT = "ae2a81ccc00e9b7c06301523e5bb09608397149c"
