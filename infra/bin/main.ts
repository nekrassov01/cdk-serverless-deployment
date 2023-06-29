#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { writeFileSync } from "fs";
import "source-map-support/register";
import { Common } from "../lib/common";
import { AppStack } from "../lib/serverless-deployment-app-stack";
import { CicdStack } from "../lib/serverless-deployment-cicd-stack";

// Get parameters from context
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
  appStack: common.getId("AppStack"),
  cicdStack: common.getId("CicdStack"),
};
writeFileSync("stack-map.json", JSON.stringify(stackMap, undefined, 2));

// Deploy stacks
const app = new App();
const appStack = new AppStack(app, stackMap.appStack, {
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
cicdStack.addDependency(appStack);

// Tagging all resources
common.addOwnerTag(app);
