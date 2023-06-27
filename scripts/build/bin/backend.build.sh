#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

for var in SERVICE ENVIRONMENT BRANCH TARGET_PATH; do
  check_variable "$var"
done

echo "PROCESS: Building lambda function."

npm install --prefix "$TARGET_PATH"
npm run lint --prefix "$TARGET_PATH"
npm run test --prefix "$TARGET_PATH" -- --watchAll=false

echo "SUCCESS: Lambda function building completed successfully."
exit 0
