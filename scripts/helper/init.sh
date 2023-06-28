#!/usr/bin/env bash

# Move to base directory
cd "$(dirname "$(readlink -f "$0")")/../.." || exit

# Validate tool exists
for tool in aws jq; do
  if ! command -v aws &>/dev/null; then
    echo "$tool not found."
    exit 1
  fi
done

# Specify context file with name defined
context='infra/cdk.json'

# Validate context file exists
if [[ ! -f "$context" ]]; then
  echo "$context not found."
  exit 1
fi

# Get context
service="$(jq -r '.context.service' <"$context")"
environment="$(jq -r '.context.environment' <"$context")"
branch="$(jq -r '.context.branch' <"$context")"
package="$(jq -r '.context.defaultConfig.lambda.package' <"$context")"
bucket="$(jq -r '.context.defaultConfig.lambda.bucket' <"$context")"
target_env="$(jq --arg env "$environment" -r '.context.environments[] | select(.name == $env)' <"$context")"
backends="$(jq -r '.context.pipelines[] | select(.type == "backend")' <"$context")"
dirs="$(jq -r '.path' <<<"$backends")"
region="$(jq -r '.region' <<<"$target_env")"
parameter_key="/$service/$environment/$branch/version/frontend"
bucket_name="$service-$environment-$branch-$bucket"

# ---------
#  STEP 1
# ---------

echo "[STEP1] PROCESS: Put frontend version string to SSM parameter store."

if [[ -n "$1" ]]; then
  if aws ssm put-parameter --name "$parameter_key" --value "$1" --type String --region "$region" --overwrite &>/dev/null; then
    echo "[STEP1] SUCCESS: Parameter '$parameter_key' stored in SSM parameter store."
  else
    echo "[STEP1] ERROR: Could not store parameter '$parameter_key' in SSM parameter store."
    echo "Process aborted." && exit 1
  fi
else
  if aws ssm get-parameter --name "$parameter_key" &>/dev/null; then
    echo "[STEP1] SUCCESS: Parameter '$parameter_key' is present, skipping."
  else
    echo "[STEP1] ERROR: Pass the frontend version to be stored in the SSM parameter store as an argument. (e.g. 'v1')"
    echo "Process aborted." && exit 1
  fi
fi

# ---------
#  STEP 2
# ---------

echo "[STEP2] PROCESS: Create bucket for lambda package deployment."

if ! aws s3 ls "s3://$bucket_name" 2>&1 | grep -q 'NoSuchBucket'; then
  echo "[STEP2] SUCCESS: Bucket $bucket_name already exists."
else
  if aws s3api create-bucket --bucket "$bucket_name" --region "$region" --create-bucket-configuration LocationConstraint="$region" &>/dev/null; then
    echo "[STEP2] SUCCESS: Bucket '$bucket_name' create complete successfully."
  else
    echo "[STEP2] ERROR: Bucket '$bucket_name' create failed."
    echo "Process aborted." && exit 1
  fi
fi

# ---------
#  STEP 3
# ---------

echo "[STEP3] PROCESS: Upload lambda package to bucket."

for dir in "${dirs[@]}"; do
  tmpDir=$(mktemp -d)
  cp -r "$dir"/* "$tmpDir"/ &>/dev/null
  cd "$tmpDir" || exit
  zip -r "$package" ./* &>/dev/null
  dest="s3://$bucket_name/$dir/$package"

  if aws s3 cp "$package" "$dest" &>/dev/null; then
    echo "[STEP3] SUCCESS: Package '$dest' upload complete successfully."
  else
    echo "[STEP3] ERROR: Package '$dest' upload failed."
    echo "Process aborted." && exit 1
  fi

  cd - >/dev/null && rm -rf "$tmpDir"
done

echo "Process finished."
