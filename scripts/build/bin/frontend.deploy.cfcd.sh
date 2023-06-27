#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for cmd in aws jq; do
  check_command "$cmd"
done

for var in SERVICE ENVIRONMENT BRANCH BUCKET_NAME PRODUCTION_DISTRIBUTION_ID FRONTEND_VERSION; do
  check_variable "$var"
done

echo "PROCESS: Copying CloudFront production distribution for staging distribution."

prod_distribution_etag=$(get_distribution_etag "$PRODUCTION_DISTRIBUTION_ID")
stg_distribution=$(copy_distribution "$PRODUCTION_DISTRIBUTION_ID" "$prod_distribution_etag")

echo "PROCESS: Updating CloudFront staging distribution config for app version: '$FRONTEND_VERSION'"

stg_distribution_id=$(jq -r '.Distribution.Id' <<<"$stg_distribution")
stg_distribution_etag=$(jq -r '.ETag' <<<"$stg_distribution")

stg_distribution_config=$(
  jq --arg bucket "$BUCKET_NAME" --arg version "/$FRONTEND_VERSION" '
  .Distribution.DistributionConfig.Origins.Items[] |=
  if .DomainName | contains($bucket) then
    .OriginPath = $version
  else
    .
  end
  | .Distribution.DistributionConfig' <<<"$stg_distribution"
)

updated_stg_distribution=$(update_distribution "$stg_distribution_id" "$stg_distribution_config" "$stg_distribution_etag")

echo "PROCESS: Creating CloudFront continuous deployment policy."

continuous_deployment_policy_config=$(
  cat <<-EOS
{
    "StagingDistributionDnsNames": {
        "Quantity": 1,
        "Items": [
            $(jq '.Distribution.DomainName' <<<"$updated_stg_distribution")
        ]
    },
    "Enabled": true,
    "TrafficConfig": {
        "SingleHeaderConfig": {
            "Header": "aws-cf-cd-staging",
            "Value": "true"
        },
        "Type": "SingleHeader"
    }
}
EOS
)
continuous_deployment_policy=$(create_continuous_deployment_policy "$continuous_deployment_policy_config")

echo "PROCESS: Attaching continuous deployment policy to CloudFront production distribution."

continuous_deployment_policy_id=$(jq '.ContinuousDeploymentPolicy.Id' <<<"$continuous_deployment_policy")
prod_distribution_config=$(jq ".DistributionConfig.ContinuousDeploymentPolicyId = $continuous_deployment_policy_id | .DistributionConfig" < <(get_distribution_config "$PRODUCTION_DISTRIBUTION_ID"))
update_distribution "$PRODUCTION_DISTRIBUTION_ID" "$prod_distribution_config" "$prod_distribution_etag"
wait_distribution_deploy "$PRODUCTION_DISTRIBUTION_ID"
wait_distribution_deploy "$stg_distribution_id"

if [[ -n "${CODEBUILD_RESOLVED_SOURCE_VERSION:-}" ]]; then
  tag_distribution "$(get_distribution_arn "$stg_distribution_id")" "CommitHash" "$CODEBUILD_RESOLVED_SOURCE_VERSION"
else
  echo "CODEBUILD_RESOLVED_SOURCE_VERSION is not set."
fi

echo "PROCESS: Putting CloudFront staging distribution ID to SSM parameter store."

put_ssm_parameter "/$SERVICE/$ENVIRONMENT/$BRANCH/cloudfront/cfcd-staging" "$stg_distribution_id"

echo "SUCCESS: CloudFront deployment completed successfully."
exit 0
