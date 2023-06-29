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
const service = common.service;
const environment = common.environment;
const branch = common.branch;
const repository = common.repository;
const domainName = common.getDomain();
const environmentConfig = common.getEnvironmentConfig();
const resourceConfig = common.resourceConfig;
const pipelines = common.pipelines;
const addresses = common.addresses;
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
  terminationProtection: common.isProductionOrStaging(),
  domainName: domainName,
});
const apiStack = new ApiStack(app, stackMap.apiStack, {
  env: env,
  terminationProtection: common.isProductionOrStaging(),
  resourceConfig: resourceConfig,
});
const hostingStack = new HostingStack(app, stackMap.hostingStack, {
  env: env,
  terminationProtection: common.isProductionOrStaging(),
  domainName: domainName,
  environmentConfig: environmentConfig,
  resourceConfig: resourceConfig,
});
const cicdStack = new CicdStack(app, stackMap.cicdStack, {
  env: env,
  terminationProtection: common.isProductionOrStaging(),
  service: service,
  environment: environment,
  branch: branch,
  repository: repository,
  domainName: domainName,
  environmentConfig: environmentConfig,
  resourceConfig: resourceConfig,
  pipelines: pipelines,
  addresses: addresses,
});

// Add dependencies among stacks
hostingStack.addDependency(certStack);
hostingStack.addDependency(apiStack);
cicdStack.addDependency(hostingStack);

// Tagging all resources
common.addOwnerTag(app);
