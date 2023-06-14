import {
  App,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambda_nodejs,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";

const app = new App();

const serviceName = app.node.tryGetContext("serviceName");
const environmentName = app.node.tryGetContext("environmentName");
const branch = app.node.tryGetContext("branch");
const functionAlias = app.node.tryGetContext("functionAlias");

export class Item1FunctionStackV2 extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const item1FunctionV2 = new lambda_nodejs.NodejsFunction(this, "Item1FunctionV2", {
      functionName: `${serviceName}-item1-v2`,
      entry: path.join(__dirname, "../../backend-v2/item1-function/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      bundling: {
        forceDockerBundling: false,
      },
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });

    const item1FunctionV2Alias = new lambda.Alias(this, "Item1FunctionV2Alias", {
      aliasName: functionAlias,
      version: item1FunctionV2.currentVersion,
    });

    new ssm.StringParameter(this, "item1FunctionV2AliasParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/lambda/v2/item1`,
      stringValue: item1FunctionV2Alias.functionArn,
    });
  }
}
