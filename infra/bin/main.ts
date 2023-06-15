#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import "source-map-support/register";
import { ApiStack } from "../lib/api-stack";
import { CertificateStack } from "../lib/certificate-stack";
import { HostingStack } from "../lib/hosting-stack";
import { Item1FunctionStack } from "../lib/item1-function-stack";
import { Item1FunctionStackV2 } from "../lib/item1-function-stack-v2";
import { Item2FunctionStack } from "../lib/item2-function-stack";
import { Item2FunctionStackV2 } from "../lib/item2-function-stack-v2";
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
const item1FunctionStack = new Item1FunctionStack(app, "Item1FunctionStack", {
  env: env,
  terminationProtection: false,
});
const item2FunctionStack = new Item2FunctionStack(app, "Item2FunctionStack", {
  env: env,
  terminationProtection: false,
});
const item1FunctionStackV2 = new Item1FunctionStackV2(app, "Item1FunctionStackV2", {
  env: env,
  terminationProtection: false,
});
const item2FunctionStackV2 = new Item2FunctionStackV2(app, "Item2FunctionStackV2", {
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
apiStack.addDependency(item1FunctionStack);
apiStack.addDependency(item2FunctionStack);
apiStack.addDependency(item1FunctionStackV2);
apiStack.addDependency(item2FunctionStackV2);
hostingStack.addDependency(certificateStack);
hostingStack.addDependency(apiStack);
pipelineStack.addDependency(hostingStack);

// Tagging all resources
Tags.of(app).add("Owner", app.node.tryGetContext("owner"));
