#!/usr/bin/env bash
# Creates the musicsquare-uploader IAM user the importer runs as, so day-to-day
# uploads never need the account's root login. Run once, signed in as an
# admin (`aws login`).
#
# The user can add objects under audio/ and masters/ in the audio bucket and
# list the bucket — nothing else. No delete, no other bucket, no other service,
# no console access.
#
# Its access key is written straight into the local AWS CLI profile
# "musicsquare-uploader" and is never printed. The importer selects that
# profile through AWS_PROFILE in .env.local.
set -euo pipefail

REGION="${AWS_REGION:-us-west-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${AUDIO_BUCKET:-musicsquare-audio-$ACCOUNT}"
USER_NAME="musicsquare-uploader"
PROFILE="musicsquare-uploader"

POLICY="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UploadCatalogueAudio",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"],
      "Resource": ["arn:aws:s3:::$BUCKET/audio/*", "arn:aws:s3:::$BUCKET/masters/*"]
    },
    {
      "Sid": "ListCatalogueBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::$BUCKET"
    }
  ]
}
JSON
)"

if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "user exists"
else
  aws iam create-user --user-name "$USER_NAME" \
    --tags Key=purpose,Value="Musicsquare catalogue uploads" >/dev/null
  echo "user created"
fi

# Inline policy: lives and dies with the user, can't be attached elsewhere.
aws iam put-user-policy --user-name "$USER_NAME" \
  --policy-name musicsquare-upload-only --policy-document "$POLICY"
echo "policy set (upload to audio/ and masters/, list bucket)"

# One key at a time. If the profile already has a working key, keep it.
if AWS_PROFILE="$PROFILE" aws sts get-caller-identity >/dev/null 2>&1; then
  echo "profile $PROFILE already works; key unchanged"
else
  KEYS="$(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text)"
  for k in $KEYS; do aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$k"; done
  # The secret goes from AWS's response straight into the CLI config file.
  read -r KEY_ID SECRET < <(aws iam create-access-key --user-name "$USER_NAME" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  aws configure set aws_access_key_id "$KEY_ID" --profile "$PROFILE"
  aws configure set aws_secret_access_key "$SECRET" --profile "$PROFILE"
  aws configure set region "$REGION" --profile "$PROFILE"
  unset KEY_ID SECRET
  echo "access key created and saved to profile $PROFILE"
fi
