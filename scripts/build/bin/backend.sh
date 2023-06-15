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

for var in SERVICE_NAME ENVIRONMENT_NAME BRANCH; do
  check_variable "$var"
done

echo "PROCESS: Deploying lambda function stack."

cd "$1"
npm install
npx cdk synth "$2"
npx cdk deploy "$2" --app cdk.public.json --require-approval never

echo "SUCCESS: ""$2"" deploying completed successfully."
exit 0
