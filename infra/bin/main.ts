#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { writeFileSync } from "fs";
import "source-map-support/register";
import { Common, pipelineType } from "../lib/common";
import { ApiStack } from "../lib/serverless-deployment-api-stack";
import { CertStack } from "../lib/serverless-deployment-cert-stack";
import { CicdStack } from "../lib/serverless-deployment-cicd-stack";
import { HostingStack } from "../lib/serverless-deployment-hosting-stack";

const common = new Common();
const environmentConfig = common.getEnvironmentConfig();
const resourceConfig = common.resourceConfig;
const domainName = common.getDomain();
const backendPipelines = common.getPipelineConfigByType(pipelineType.Backend);
const env = {
  account: environmentConfig.account,
  region: environmentConfig.region,
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
  domainName: domainName,
  terminationProtection: common.isProductionOrStaging(),
});
const apiStack = new ApiStack(app, stackMap.apiStack, {
  env: env,
  resourceConfig: resourceConfig,
  terminationProtection: false,
});
const hostingStack = new HostingStack(app, stackMap.hostingStack, {
  env: env,
  environmentConfig: environmentConfig,
  resourceConfig: resourceConfig,
  domainName: domainName,
  terminationProtection: false,
});
const cicdStack = new CicdStack(app, stackMap.cicdStack, {
  env: env,
  environmentConfig: environmentConfig,
  resourceConfig: resourceConfig,
  domainName: domainName,
  backendPipelines: backendPipelines,
  terminationProtection: false,
});

// Add dependencies among stacks
hostingStack.addDependency(certStack);
hostingStack.addDependency(apiStack);
cicdStack.addDependency(hostingStack);

// Tagging all resources
common.addOwnerTag(app);
