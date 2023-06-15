#!/usr/bin/env bash

set -euo pipefail

stack_name="AppStack"

if [[ "$(aws cloudformation describe-stack-drift-detection-status --stack-drift-detection-id "$(aws cloudformation detect-stack-drift --stack-name "$stack_name" --query "StackDriftDetectionId" --output text)" --query "StackDriftStatus" --output text)" == "IN_SYNC" ]]; then
  echo "No drift detected. Exiting."
  exit 0
fi

drift_info=$(aws cloudformation describe-stack-resource-drifts --stack-name $stack_name)

# 指定パラメータの解決値、またはタグが更新されているか確認
if echo "$drift_info" | grep -q "\"ParameterKey\": \"MyParameter\"" || echo "$drift_info" | grep -q "\"Tags\""; then
  echo "Only specified parameter's resolved value or tags have been updated."

  # 更新されたテンプレートの取得とスタックの更新
  updated_template=$(aws cloudformation get-template --stack-name $stack_name --query 'TemplateBody' --output text)
  aws cloudformation update-stack --stack-name $stack_name --template-body "$updated_template" --parameters '[
      {
        "ParameterKey": "Param1",
        "ParameterValue": "NewValue1"
      },
      {
        "ParameterKey": "Param2",
        "ParameterValue": "NewValue2"
      }
    ]'
else
  echo "Updates other than specified parameter's resolved value or tags have been detected. Exiting."
  exit 1
fi
