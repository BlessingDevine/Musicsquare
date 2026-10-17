#!/bin/sh
# Builds "Squaredrum Admin.app" on the Desktop: double-click it to start the
# admin server (if it isn't running already) and open the page in the browser.
#   sh scripts/admin/make-app.sh
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Desktop/Squaredrum Admin.app"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"export PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH; cd '$REPO'; if ! curl -s -o /dev/null http://localhost:4747/health; then nohup node scripts/admin/server.mjs > /tmp/squaredrum-admin.log 2>&1 & sleep 2; fi; open http://localhost:4747\""
# The Squaredrum mark as its icon. Newer macOS reads the icon from Assets.car
# (CFBundleIconName) before applet.icns, so that goes; then the app is re-signed.
ICON="$REPO/scripts/admin/icon.png"
if [ -f "$ICON" ]; then
  SET="$(mktemp -d)/applet.iconset"
  mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$ICON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/applet.icns"
  rm -f "$APP/Contents/Resources/Assets.car"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
  codesign --force --sign - "$APP" 2>/dev/null || true
  touch "$APP"
fi
echo "Made $APP"
