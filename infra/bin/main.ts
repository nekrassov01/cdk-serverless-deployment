#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { writeFileSync } from "fs";
import "source-map-support/register";
import { Common } from "../lib/common";
import { ApiStack } from "../lib/serverless-deployment-api-stack";
import { CertStack } from "../lib/serverless-deployment-cert-stack";
import { CicdStack } from "../lib/serverless-deployment-cicd-stack";
import { HostingStack } from "../lib/serverless-deployment-hosting-stack";

const common = new Common();

// Accident prevention
common.verifyEnvironment();
common.verifyCallerAccount();
common.verifyBranch();

// Get `env` for deploying stacks from 'cdk.json'
const targetEnv = common.getEnvironment();
const env = {
  account: targetEnv.account,
  region: targetEnv.region,
};

// Create stack name list
const stackMap = {
  certStack: common.getId("CertStack"),
  apiStack: common.getId("ApiStack"),
  hostingStack: common.getId("HostingStack"),
  cicdStack: common.getId("CicdStack"),
};

// Export stack name list to file
writeFileSync("stack-map.json", JSON.stringify(stackMap, undefined, 2));

// Deploy stacks
const app = new App();
const certStack = new CertStack(app, stackMap.certStack, {
  env: env,
  terminationProtection: common.isProductionOrStaging(),
});
const apiStack = new ApiStack(app, stackMap.apiStack, {
  env: env,
  terminationProtection: false,
});
const hostingStack = new HostingStack(app, stackMap.hostingStack, {
  env: env,
  terminationProtection: false,
});
const cicdStack = new CicdStack(app, stackMap.cicdStack, {
  env: env,
  terminationProtection: false,
});

// Add dependencies among stacks
hostingStack.addDependency(certStack);
hostingStack.addDependency(apiStack);
cicdStack.addDependency(hostingStack);

// Tagging all resources
common.addOwnerTag(app);
