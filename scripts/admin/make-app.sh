#!/bin/sh
# Builds "Squaredrum Admin.app" on the Desktop: double-click it to start the
# admin server (if it isn't running already) and open the page in the browser.
#   sh scripts/admin/make-app.sh
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Desktop/Squaredrum Admin.app"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"export PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH; cd '$REPO'; if ! curl -s -o /dev/null http://localhost:4747/health; then nohup node scripts/admin/server.mjs > /tmp/squaredrum-admin.log 2>&1 & sleep 2; fi; open http://localhost:4747\""
# The Squaredrum mark as its icon, when the logo is on this Mac.
ICON="$REPO/scripts/admin/icon.png"
if [ -f "$ICON" ]; then
  sips -s format icns "$ICON" --out "$APP/Contents/Resources/applet.icns" >/dev/null 2>&1 || true
  touch "$APP"
fi
echo "Made $APP"
