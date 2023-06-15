#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

for var in SERVICE_NAME ENVIRONMENT_NAME BRANCH DISTRIBUTION_ID; do
  check_variable "$var"
done

echo "PROCESS: Overriding CloudFront production distribution config with staging config."

stg_distribution_id=$(get_ssm_parameter "/$SERVICE_NAME/$ENVIRONMENT_NAME/$BRANCH/cloudfront/cfcd-staging")
prod_distribution_etag=$(get_distribution_etag "$DISTRIBUTION_ID")
stg_distribution_etag=$(get_distribution_etag "$stg_distribution_id")
update_distribution_with_staging_config "$DISTRIBUTION_ID" "$stg_distribution_id" "$prod_distribution_etag" "$stg_distribution_etag"
wait_distribution_deploy "$DISTRIBUTION_ID"

echo "SUCCESS: Staging distribution promotion completed successfully."
exit 0
