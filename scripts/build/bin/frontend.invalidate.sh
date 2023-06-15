#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

check_variable DISTRIBUTION_ID

invalidation=$(create_invalidation "$DISTRIBUTION_ID")
invalidation_id=$(jq -r '.Invalidation.Id' <<<"$invalidation")
wait_invalidation "$invalidation_id" "$DISTRIBUTION_ID"

echo "SUCCESS: CloudFront distribution cache invalidation completed successfully."
exit 0
