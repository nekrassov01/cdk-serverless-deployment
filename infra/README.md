# cdk-cloudfront deployment

## Overview

This is a sample CDK for running continuous CloudFront deployments with CodePipeline.
However, the sample React apps deployed on S3 are assumed to be hosted on CodeCommit, so the contents cannot be viewed in this repository.

## Prerequisites

The version of application frontend must be stored in the SSM parameter store as follows:

```sh
$ # This key is layered with service name, environment name, branch name, etc.
$ aws ssm get-parameter --name "/cfcd-test/dev/feature/version/frontend" --query "Parameter.Value" --output text
v3
```

## Usage

The following command will launch a sample CloudFront distribution, hosting bucket, and pipeline for continuous deployment.

```sh
npx cdk synth --all
npx cdk deploy --all
```

## Pipeline actions

The following process automates deployment.

1. Detect changes in the CodeCommit repository, build the React app, and deploy the contents in a subfolder with the version name via s3 sync
2. Continuous deployment of CloudFront is performed by CodeBuild. Only requests with specific headers will be routed to the staging distribution
3. If the test is OK, pass it through manually at the approval stage
4. The staging distribution configuration overrides the production distribution, and the staging distribution that is no longer needed is removed (performed by CodeBuild)

## Todo

About buildspec
