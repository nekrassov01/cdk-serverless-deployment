#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

for var in SERVICE ENVIRONMENT BRANCH PRODUCTION_DISTRIBUTION_ID STAGING_DISTRIBUTION_ID; do
  check_variable "$var"
done

echo "PROCESS: Detaching continuous deployment policy from CloudFront production distribution."

prod_distribution_config=$(get_distribution_config "$PRODUCTION_DISTRIBUTION_ID")
continuous_deployment_policy_id=$(echo "$prod_distribution_config" | jq -r ".DistributionConfig.ContinuousDeploymentPolicyId")
prod_distribution_etag=$(echo "$prod_distribution_config" | jq -r ".ETag")
updated_prod_distribution_config=$(echo "$prod_distribution_config" | jq ".DistributionConfig.ContinuousDeploymentPolicyId = \"\" | .DistributionConfig")
update_distribution "$PRODUCTION_DISTRIBUTION_ID" "$updated_prod_distribution_config" "$prod_distribution_etag"
wait_distribution_deploy "$PRODUCTION_DISTRIBUTION_ID"

echo "PROCESS: Deleting continuous deployment policy."

continuous_deployment_policy_etag=$(get_continuous_deployment_policy_etag "$continuous_deployment_policy_id")
delete_continuous_deployment_policy "$continuous_deployment_policy_id" "$continuous_deployment_policy_etag"

echo "PROCESS: Disabling CloudFront staging distribution."

stg_distribution_config=$(get_distribution_config "$STAGING_DISTRIBUTION_ID")
stg_distribution_etag=$(echo "$stg_distribution_config" | jq -r ".ETag")
updated_stg_distribution_config=$(echo "$stg_distribution_config" | jq ".DistributionConfig.Enabled = false | .DistributionConfig")
stg_distribution=$(update_distribution "$STAGING_DISTRIBUTION_ID" "$updated_stg_distribution_config" "$stg_distribution_etag")
wait_distribution_deploy "$STAGING_DISTRIBUTION_ID"

echo "PROCESS: Deleting CloudFront staging distribution."

stg_distribution_etag=$(echo "$stg_distribution" | jq -r ".ETag")
delete_distribution "$STAGING_DISTRIBUTION_ID" "$stg_distribution_etag"

echo "SUCCESS: Staging distribution clean up completed successfully."
exit 0
