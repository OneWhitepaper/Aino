"""Check for an App Installer update for the running MSIX package.

The out-of-store desktop installs are App Installer owned: the OS registered
the .appinstaller URI as the package's update source at install, so the
OS can tell us whether a newer package version is available. The desktop
shows its own prompt + tears down before the OS applies the swap.

Run with the BUNDLED payload python (the winrt package ships there):

    <payload>/tools/<python-entry>/python.exe -P -m hermes_cli.windows_appinstaller_update

Use ``--source-only`` before apply to read the fresh OS-registered URI without
contacting that feed. Its disjoint ``source_resolution`` response is registered,
not-packaged, or error; it never claims update availability.

Exit codes:
  0  source resolved, no update available, or this process has no package identity
  2  update available (the caller decides whether to prompt/teardown)
  1  error, including a missing registered App Installer update source

API shape (pywinrt projection, verified against the installed winrt 3.2.1):
``Package.current`` is a static PROPERTY; the update check is the instance
method ``Package.check_update_availability_async`` — ``PackageManager`` has
no such method. Resolve the current identity through ``FindPackageForUser``
first: Microsoft documents Access denied when checking ``Package.current`` directly.
``PackageUpdateAvailability`` members (verified live in the
installed projection): UNKNOWN=0, NO_UPDATES=1, AVAILABLE=2, REQUIRED=3,
ERROR=4. Only the specific "no package identity" HRESULT (0x80073D54) means
not-packaged; every other failure is an unknown, never a "no update".
"""

import argparse
import json
import sys

# HRESULT 0x80073D54 — "The process has no package identity." The one
# failure that positively identifies a non-packaged (dev) run.
_NO_PACKAGE_IDENTITY_HRESULT = -2147009196


def _load_projection():
    from winrt.windows.applicationmodel import Package, PackageUpdateAvailability
    from winrt.windows.management.deployment import PackageManager

    return Package, PackageUpdateAvailability, PackageManager


def _error(message: str, *, source_only: bool, reason: str | None = None) -> int:
    result = {"source_resolution": "error"} if source_only else {"available": None}
    result["error"] = message
    if reason:
        result["reason"] = reason
    print(json.dumps(result))
    return 1


def main(*, source_only: bool = False) -> int:
    try:
        Package, PackageUpdateAvailability, PackageManager = _load_projection()
    except ImportError as exc:
        # The winrt module is absent (older payload without the dep): the
        # update check cannot run. Report unknown, not "no update".
        return _error(f"winrt import failed: {exc}", source_only=source_only)

    # Property access, not a call: a packaged process gets the Package
    # instance; a dev run raises the package-identity HRESULT.
    try:
        package = Package.current
    except OSError as exc:
        if getattr(exc, "winerror", None) == _NO_PACKAGE_IDENTITY_HRESULT:
            print(json.dumps({"source_resolution": "not-packaged"} if source_only
                             else {"available": False, "reason": "not-packaged"}))
            return 0
        return _error(f"package identity failed: {exc}", source_only=source_only)
    except Exception as exc:
        return _error(f"package identity failed: {exc}", source_only=source_only)

    try:
        package = PackageManager().find_package_by_user_security_id_package_full_name("", package.id.full_name)
        source = package.get_app_installer_info()
        if source is None:
            return _error(
                "No App Installer update source is registered. Install Hermes through its .appinstaller file to enable updates.",
                source_only=source_only, reason="no-app-installer-source")
        source_uri = source.uri.absolute_uri
        if source_only:
            if not isinstance(source_uri, str) or not source_uri.strip():
                raise ValueError("The registered App Installer source URI is empty")
            print(json.dumps({"source_resolution": "registered", "source_uri": source_uri}))
            return 0
        result = package.check_update_availability_async().get()
        availability = PackageUpdateAvailability(result.availability)
    except Exception as exc:
        prefix = "source resolution failed" if source_only else "check failed"
        return _error(f"{prefix}: {exc}", source_only=source_only)

    # Only AVAILABLE / REQUIRED mean "a newer package exists". NO_UPDATES is
    # the one honest "no". UNKNOWN and ERROR are NOT "no update" — reporting
    # them as such would suppress a real update prompt — so they surface as
    # an unknown with the availability name as the extended error.
    if availability == PackageUpdateAvailability.NO_UPDATES:
        print(json.dumps({"available": False, "availability": availability.name, "source_uri": source_uri}))
        return 0

    if availability in (PackageUpdateAvailability.AVAILABLE, PackageUpdateAvailability.REQUIRED):
        print(json.dumps({"available": True, "availability": availability.name, "source_uri": source_uri}))
        return 2

    print(json.dumps({"available": None, "error": f"availability unknown: {availability.name}"}))
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="Read the registered source without a network availability check")
    sys.exit(main(source_only=parser.parse_args().source_only))
