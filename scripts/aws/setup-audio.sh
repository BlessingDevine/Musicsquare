#!/usr/bin/env bash
# One-time AWS setup for the catalogue audio. Safe to re-run: each step checks
# whether its resource already exists.
#
#   S3 bucket   private, all public access blocked. Holds audio/ (streaming
#               MP3s) and masters/ (WAVs, never served).
#   CloudFront  the only way in. Origin Access Control signs its requests to
#               S3, and the bucket policy lets it read audio/* and nothing else.
#               SimpleCORS adds Access-Control-Allow-Origin: * so a Web Audio
#               visualiser could read the stream later.
#
# Prints the CloudFront address for NEXT_PUBLIC_AUDIO_BASE_URL.
set -euo pipefail

REGION="${AWS_REGION:-us-west-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${AUDIO_BUCKET:-musicsquare-audio-$ACCOUNT}"
OAC_NAME="musicsquare-audio-oac"
COMMENT="Musicsquare Radio catalogue audio"

# AWS managed policies (fixed IDs, same in every account).
CACHE_OPTIMIZED="658327ea-f89d-4fab-a63d-7e88639e58f6"
SIMPLE_CORS="60669652-455b-4ae9-85a4-c4c02393f86c"

echo "account $ACCOUNT  region $REGION  bucket $BUCKET"

# --- bucket ------------------------------------------------------------------
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "bucket exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "bucket created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# --- origin access control -----------------------------------------------------
OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" --output text)"
if [ "$OAC_ID" = "None" ] || [ -z "$OAC_ID" ]; then
  OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=$OAC_NAME,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query OriginAccessControl.Id --output text)"
  echo "origin access control created"
fi

# --- distribution ----------------------------------------------------------------
DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)"
if [ "$DIST_ID" = "None" ] || [ -z "$DIST_ID" ]; then
  CONFIG="$(cat <<JSON
{
  "CallerReference": "musicsquare-audio-$(date +%s)",
  "Comment": "$COMMENT",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "PriceClass": "PriceClass_All",
  "Origins": { "Quantity": 1, "Items": [{
    "Id": "s3-audio",
    "DomainName": "$BUCKET.s3.$REGION.amazonaws.com",
    "OriginAccessControlId": "$OAC_ID",
    "S3OriginConfig": { "OriginAccessIdentity": "" }
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-audio",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] } },
    "CachePolicyId": "$CACHE_OPTIMIZED",
    "ResponseHeadersPolicyId": "$SIMPLE_CORS",
    "Compress": false
  }
}
JSON
)"
  DIST_ID="$(aws cloudfront create-distribution --distribution-config "$CONFIG" \
    --query Distribution.Id --output text)"
  echo "distribution created (takes a few minutes to deploy)"
fi
DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)"

# --- bucket policy: CloudFront may read audio/* only ------------------------------
POLICY="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "CloudFrontReadsStreamingAudio",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/audio/*",
    "Condition": { "StringEquals": {
      "AWS:SourceArn": "arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID" } }
  }]
}
JSON
)"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$POLICY"

echo
echo "AUDIO_BUCKET=$BUCKET"
echo "AWS_REGION=$REGION"
echo "NEXT_PUBLIC_AUDIO_BASE_URL=https://$DOMAIN"
