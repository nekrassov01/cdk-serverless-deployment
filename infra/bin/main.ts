#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import "source-map-support/register";
import { ApiStack } from "../lib/api-stack";
import { CertificateStack } from "../lib/certificate-stack";
import { HostingStack } from "../lib/hosting-stack";
import { PipelineStack } from "../lib/pipeline-stack";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Deploy stacks
const app = new App();

const certificateStack = new CertificateStack(app, "CertificateStack", {
  env: env,
  terminationProtection: false,
});
const apiStack = new ApiStack(app, "ApiStack", {
  env: env,
  terminationProtection: false,
});
const hostingStack = new HostingStack(app, "HostingStack", {
  env: env,
  terminationProtection: false,
});
const pipelineStack = new PipelineStack(app, "PipelineStack", {
  env: env,
  terminationProtection: false,
});

// Add dependencies among stacks
hostingStack.addDependency(certificateStack);
hostingStack.addDependency(apiStack);
pipelineStack.addDependency(hostingStack);

// Tagging all resources
Tags.of(app).add("Owner", app.node.tryGetContext("owner"));
