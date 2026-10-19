#!/usr/bin/env bash
# Export Pal or Pal Dev using native Xcode managed Ad Hoc signing.
# Usage: ios/scripts/export-adhoc.sh prod|dev BUILD_NUMBER
# Creates local archives/IPAs and may update Apple-managed signing resources.
set -euo pipefail
cd "$(dirname "$0")/../.."
variant="${1:?Expected prod or dev}"; build="${2:?Expected a unique build number}"
[[ "$build" =~ ^[0-9]+$ ]] || { echo 'Build number must be an integer' >&2; exit 2; }
case "$variant" in prod) scheme=Pal;; dev) scheme='Pal Dev';; *) echo 'Use prod or dev' >&2; exit 2;; esac
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
output=".local/adhoc/$variant-$build"
[[ ! -e "$output" ]] || { echo 'Output already exists; use a new build number' >&2; exit 2; }
mkdir -p "$output"
xcodebuild -project ios/Pal/Pal.xcodeproj -scheme "$scheme" \
  -destination 'generic/platform=iOS' -archivePath "$output/Pal.xcarchive" \
  -derivedDataPath .local/adhoc/derived -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$build" archive > "$output/archive.log" 2>&1
xcodebuild -exportArchive -archivePath "$output/Pal.xcarchive" \
  -exportPath "$output/export" -exportOptionsPlist ios/Pal/Configuration/ExportOptions.plist \
  -allowProvisioningUpdates > "$output/export.log" 2>&1
printf 'Exported %s/export/Pal.ipa\n' "$output"
