#!/usr/bin/env bash
# Make CloudFront send Access-Control-Allow-Origin on every audio response.
# Run once, signed in as an admin (`aws login`). Safe to re-run.
#
# Why: the managed "SimpleCORS" response headers policy leaves the header
# out when the request carries `Priority` (which Chrome and Safari send on
# every fetch) or `Cache-Control: no-cache` — so browsers were never allowed
# to read the files, while curl (which sends neither) always was. That
# silently kept every browser out of the Web Audio crossfade. CloudFront
# refuses Access-Control-Allow-Origin as a custom header, so this is a custom
# CORS config: any origin, with OriginOverride on.
set -euo pipefail

POLICY_NAME="musicsquare-audio-cors-always"
COMMENT="Musicsquare Radio catalogue audio"

POLICY_ID="$(aws cloudfront list-response-headers-policies --type custom \
  --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$POLICY_NAME'].ResponseHeadersPolicy.Id | [0]" \
  --output text)"
if [ "$POLICY_ID" = "None" ] || [ -z "$POLICY_ID" ]; then
  POLICY_ID="$(aws cloudfront create-response-headers-policy --response-headers-policy-config '{
    "Name": "'"$POLICY_NAME"'",
    "Comment": "Allow any origin to read the audio, regardless of request headers",
    "CorsConfig": {
      "AccessControlAllowOrigins": { "Quantity": 1, "Items": ["*"] },
      "AccessControlAllowHeaders": { "Quantity": 1, "Items": ["*"] },
      "AccessControlAllowMethods": { "Quantity": 3, "Items": ["GET", "HEAD", "OPTIONS"] },
      "AccessControlExposeHeaders": { "Quantity": 3, "Items": ["Content-Length", "Content-Range", "Accept-Ranges"] },
      "AccessControlAllowCredentials": false,
      "AccessControlMaxAgeSec": 86400,
      "OriginOverride": true
    }
  }' --query ResponseHeadersPolicy.Id --output text)"
  echo "response headers policy created: $POLICY_ID"
else
  echo "response headers policy exists: $POLICY_ID"
fi

DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)"
CURRENT="$(aws cloudfront get-distribution-config --id "$DIST_ID" \
  --query DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId --output text)"
if [ "$CURRENT" = "$POLICY_ID" ]; then
  echo "distribution $DIST_ID already uses it"
  exit 0
fi

TMP="$(mktemp)"
aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP"
ETAG="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).ETag)' "$TMP")"
node -e '
  const fs = require("fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).DistributionConfig;
  c.DefaultCacheBehavior.ResponseHeadersPolicyId = process.argv[2];
  fs.writeFileSync(process.argv[1] + ".new", JSON.stringify(c));
' "$TMP" "$POLICY_ID"
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
  --distribution-config "file://$TMP.new" --query Distribution.Status --output text
rm -f "$TMP" "$TMP.new"
echo "distribution $DIST_ID now uses $POLICY_NAME (deploys in a few minutes)"
