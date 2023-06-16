#!/usr/bin/env bash

set -euo pipefail

if [ -z "$1" ]; then
  echo "Required directory name!"
  exit 1
fi

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

for var in SERVICE_NAME ENVIRONMENT_NAME BRANCH BUCKET_NAME BUCKET_PATH FUNCTION_NAME FUNCTION_ALIAS FUNCTION_PACKAGE_NAME; do
  check_variable "$var"
done

echo "PROCESS: Deploying lambda function stack."
cd "$BUCKET_PATH"

echo "PROCESS: Installing node modules."
npm install

echo "PROCESS: Packaging lambda function."
zip -r "$FUNCTION_PACKAGE_NAME" .

echo "PROCESS: Packaging lambda function."
aws s3 cp "$FUNCTION_PACKAGE_NAME" s3://"$BUCKET_NAME/$BUCKET_PATH"/

echo "PROCESS: Updating lambda function."
new_version=$(update_function_code_and_get_version "$FUNCTION_NAME" "$BUCKET_NAME" "$BUCKET_PATH/$FUNCTION_PACKAGE_NAME")

echo "PROCESS: Updating lambda function alias."
update_function_alias "$FUNCTION_NAME" "$FUNCTION_ALIAS" "$new_version"

echo "SUCCESS: Lambda function deploying completed successfully."
exit 0