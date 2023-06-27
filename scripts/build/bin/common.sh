#!/usr/bin/env bash

set -euo pipefail

export AWS_DEFAULT_REGION='ap-northeast-1'

check_command() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: '$1' command not found."
    exit 1
  fi
}

check_variable() {
  if [ -z "${!1:-}" ]; then
    echo "ERROR: Variable '$1' not exported."
    exit 1
  fi
  echo "PROCESS: Checking environment variable '$(env | grep "$1")'"
}

get_ssm_parameter() {
  aws ssm get-parameter --name "$1" --query "Parameter.Value" --output text || {
    echo "ERROR: Failed to get '$1' from SSM parameter store."
    exit 1
  }
}

put_ssm_parameter() {
  aws ssm put-parameter --name "$1" --value "$2" --type String --overwrite || {
    echo "ERROR: Failed to put '$1' in SSM parameter store."
    exit 1
  }
}

deploy_content() {
  aws s3 sync "$1" "$2" --exact-timestamps --delete 1>/dev/null || {
    echo "ERROR: Failed to synchronize contents to hosting bucket."
    exit 1
  }
}

get_distribution_etag() {
  aws cloudfront get-distribution --id "$1" --query "ETag" --output text || {
    echo "ERROR: Failed to get 'ETag' from '$1'."
    exit 1
  }
}

get_distribution_arn() {
  aws cloudfront get-distribution --id "$1" --query 'Distribution.ARN' --output text || {
    echo "ERROR: Failed to get 'ARN' from '$1'."
    exit 1
  }
}

get_distribution_config() {
  aws cloudfront get-distribution-config --id "$1" || {
    echo "ERROR: Failed to get 'DistributionConfig' from '$1'."
    exit 1
  }
}

update_distribution() {
  aws cloudfront update-distribution --id "$1" --distribution-config "$2" --if-match "$3" || {
    echo "ERROR: Failed to update distribution '$1'."
    exit 1
  }
}

copy_distribution() {
  aws cloudfront copy-distribution --primary-distribution-id "$1" --if-match "$2" --staging --caller-reference "$(date +%Y%m%d%H%M%S)" || {
    echo "ERROR: Failed to copy distribution '$1' for staging distribution."
    exit 1
  }
}

create_continuous_deployment_policy() {
  aws cloudfront create-continuous-deployment-policy --continuous-deployment-policy-config "$1" || {
    echo "ERROR: Failed to create continuous deployment policy."

  }
}

update_distribution_with_staging_config() {
  aws cloudfront update-distribution-with-staging-config --id "$1" --staging-distribution-id "$2" --if-match "$3","$4" || {
    echo "ERROR: Failed to update distribution '$1' with staging distribution '$2' config."
    exit 1
  }
}

get_continuous_deployment_policy_etag() {
  aws cloudfront get-continuous-deployment-policy --id "$1" --query "ETag" --output text || {
    echo "ERROR: Failed to get continuous deployment policy '$1' ETag."
    exit 1
  }
}

delete_continuous_deployment_policy() {
  aws cloudfront delete-continuous-deployment-policy --id "$1" --if-match "$2" || {
    echo "ERROR: Failed to delete continuous deployment policy '$1'."
    exit 1
  }
}

delete_distribution() {
  aws cloudfront delete-distribution --id "$1" --if-match "$2" || {
    echo "ERROR: Failed to delete distribution '$1'."
    exit 1
  }
}

create_invalidation() {
  aws cloudfront create-invalidation --distribution-id "$1" --paths "/*" || {
    echo "ERROR: Failed to create invalidation for $1."
    exit 1
  }
}

wait_invalidation() {
  echo "PROCESS: Waiting for '$1' to invalidate..."
  status=""
  while [ "$status" != "Completed" ]; do
    sleep 5
    status=$(aws cloudfront get-invalidation --id "$1" --distribution-id "$2" --query "Invalidation.Status" --output text) || {
      echo "ERROR: Failed to get invalidation from '$2'."
      exit 1
    }
    echo "STATUS: $status"
  done
}

wait_distribution_deploy() {
  echo "PROCESS: Waiting for '$1' to deploy..."
  status=""
  while [ "$status" != "Deployed" ]; do
    sleep 5
    status=$(aws cloudfront get-distribution --id "$1" --query "Distribution.Status" --output text) || {
      echo "ERROR: Failed to get 'Distribution.Status' from '$1'."
      exit 1
    }
    echo "STATUS: $status"
  done
}

tag_distribution() {
  aws cloudfront tag-resource --resource "$1" --tags "$2=$3" || {
    echo "ERROR: Failed to tag distribution for $1."
    exit 1
  }
}

get_function_arn() {
  aws lambda get-function --function-name "serverless-deployment-dev-feature-item1" --query "Configuration.FunctionArn" --output text || {
    echo "ERROR: Failed to get 'ARN' from '$1'."
    exit 1
  }
}

update_function_code_and_get_version() {
  aws lambda update-function-code --function-name "$1" --s3-bucket "$2" --s3-key "$3" --publish --query "Version" --output text || {
    echo "ERROR: Failed to update function for $1."
    exit 1
  }
}

update_function_alias() {
  aws lambda update-alias --function-name "$1" --name "$2" --function-version "$3" || {
    echo "ERROR: Failed to update function alias for $1."
    exit 1
  }
}

tag_function() {
  aws lambda tag-resource --resource "$1" --tags "$2=$3" || {
    echo "ERROR: Failed to tag function for $1."
    exit 1
  }
}
