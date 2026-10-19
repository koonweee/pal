#!/usr/bin/env python3
"""Verify a production Pal Ad Hoc IPA before internal publication."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def command(*arguments: str, input_bytes: bytes | None = None) -> bytes:
    return subprocess.run(
        arguments,
        input=input_bytes,
        capture_output=True,
        check=True,
    ).stdout


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: verify-adhoc.py /path/Pal.ipa BUILD_NUMBER")
    ipa = Path(sys.argv[1])
    expected_build = sys.argv[2]
    expected_bundle = os.environ.get("PAL_IOS_BUNDLE_ID", "com.example.pal")
    with tempfile.TemporaryDirectory(prefix="pal-ipa-") as temporary:
        with zipfile.ZipFile(ipa) as archive:
            candidates = [
                name
                for name in archive.namelist()
                if name.startswith("Payload/")
                and name.count("/") == 2
                and name.endswith(".app/Info.plist")
            ]
            if len(candidates) != 1:
                raise SystemExit("IPA must contain exactly one app")
            archive.extractall(temporary)
        app = Path(temporary) / candidates[0].removesuffix("Info.plist")
        info = plistlib.loads((app / "Info.plist").read_bytes())
        if info["CFBundleIdentifier"] != expected_bundle:
            raise SystemExit("Unexpected bundle identifier")
        if info.get("CFBundleDisplayName") != "Pal":
            raise SystemExit("Unexpected display name")
        if info["CFBundleVersion"] != expected_build:
            raise SystemExit("Unexpected build number")
        if info.get("PalDefaultServerURL"):
            raise SystemExit("Production app must require explicit backend configuration")
        if info.get("PalAPNSEnvironment") != "production":
            raise SystemExit("Packaged APNs registration environment is not production")
        if "remote-notification" not in info.get("UIBackgroundModes", []):
            raise SystemExit("Remote notification background mode is missing")

        command("codesign", "--verify", "--deep", "--strict", str(app))
        entitlements = plistlib.loads(
            command("codesign", "-d", "--entitlements", ":-", str(app))
        )
        profile = plistlib.loads(
            command(
                "security",
                "cms",
                "-D",
                "-i",
                str(app / "embedded.mobileprovision"),
            )
        )
        signed_application = entitlements.get("application-identifier")
        if not isinstance(signed_application, str) or not signed_application.endswith(
            f".{expected_bundle}"
        ):
            raise SystemExit("Unexpected signed application identifier")
        if entitlements.get("aps-environment") != "production":
            raise SystemExit("Signed APNs environment is not production")
        profile_entitlements = profile.get("Entitlements", {})
        if profile_entitlements.get("application-identifier") != signed_application:
            raise SystemExit("Provisioning profile does not match Pal")
        if profile_entitlements.get("aps-environment") != "production":
            raise SystemExit("Provisioning profile APNs environment is not production")
        if profile_entitlements.get("get-task-allow"):
            raise SystemExit("Expected an Ad Hoc profile")
        devices = profile.get("ProvisionedDevices", [])
        if not devices:
            raise SystemExit("Ad Hoc profile contains no devices")
        expiration = profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
        if expiration <= datetime.datetime.now(datetime.timezone.utc):
            raise SystemExit("Provisioning profile has expired")

    print(
        json.dumps(
            {
                "bundleId": expected_bundle,
                "version": info["CFBundleShortVersionString"],
                "build": expected_build,
                "signatureVerified": True,
                "apns": "production",
                "deviceCount": len(devices),
                "expires": expiration.isoformat(),
                "sha256": hashlib.sha256(ipa.read_bytes()).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
