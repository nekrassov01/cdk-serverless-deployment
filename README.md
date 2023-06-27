# cdk-serverless-deployment

## Overview

This is a sample monorepo with a frontend deployed with CloudFront + S3 and a backend deployed with API Gateway + Lambda,
each element configured to be deployed separately and continuously.

## Directories

```text
.
├── backend
│   ├── item1    # lambda sample function v1-1
│   └── item2    # lambda sample function v1-2
├── backend-v2
│   ├── item1    # lambda sample function v2-1
│   └── item2    # lambda sample function v2-2
├── frontend     # react sample app
├── infra
└── scripts
```

## Prerequisites

Configure each context in `cdk.json`

```json
{
  ...
  "context": {
    ...
    "service": "app",
    "owner": "user",
    "addresses": ["user@your-domain.com"],
    "environment": "dev",
    "repository": "test-repo",
    "branch": "feature",
    "resourceConfig": {
      "apigateway": {
        "stage": "default"
      },
      "lambda": {
        "bucket": "lambda-packages",
        "alias": "live",
        "package": "function.zip"
      },
      "codebuild": {
        "localDir": "scripts/build"
      }
    },
    "environments": [
      {
        "name": "dev",
        "account": "000000000000",
        "region": "ap-northeast-1",
        "hostedZone": "dev.example.com",
        "webAcl": "dummy-arn-1"
      },
      {
        "name": "stg",
        "account": "111111111111",
        "region": "ap-northeast-1",
        "hostedZone": "stg.example.com",
        "webAcl": "dummy-arn-2"
      },
      {
        "name": "prod",
        "account": "222222222222",
        "region": "ap-northeast-1",
        "hostedZone": "example.com",
        "webAcl": "dummy-arn-3"
      }
    ],
    "pipelines": [
      {
        "name": "item1",
        "path": "backend/item1",
        "type": "backend"
      },
      {
        "name": "item2",
        "path": "backend/item2",
        "type": "backend"
      },
      {
        "name": "item1-v2",
        "path": "backend-v2/item1",
        "type": "backend"
      },
      {
        "name": "item2-v2",
        "path": "backend-v2/item1",
        "type": "backend"
      },
      {
        "name": "frontend",
        "path": "frontend",
        "type": "frontend"
      }
    ],
    "containers": [
      {
        "name": "test-container",
        "environment": "dev",
        "repository": "ecr-repo/test-container",
        "imagePath": "src/image/test-container",
        "version": ["1.0.0"],
        "tag": "1.0.0"
      }
    ]
  }
}
```

Run the initialization script. The following process will be executed

   1. Put frontend version string to SSM parameter store
   2. Create bucket for lambda package deployment
   3. Upload lambda package to bucket

```bash
bash /scripts/helper/init.sh
```

## Deploy stacks

The following command will launch some stacks

```sh
npx cdk synth --all
npx cdk deploy --all
```

## Pipeline actions

### Backend

1. Lint and test are executed
1. Lambda function changes are placed in the S3 bucket
1. Lambda function is updated and version is issued
1. Aliases are repointed with the latest version

### Frontend

1. Lint, test and build are executed
1. Deploy the contents in a subfolder with the version name via s3 sync
1. Continuous deployment of CloudFront is performed by CodeBuild. Only requests with specific headers will be routed to the staging distribution
1. If the test is OK, pass it through manually at the approval stage
1. The staging distribution configuration overrides the production distribution, and the staging distribution that is no longer needed is removed (performed by CodeBuild)
