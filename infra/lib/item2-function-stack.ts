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

export class Item2FunctionStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const item2Function = new lambda_nodejs.NodejsFunction(this, "Item2Function", {
      functionName: `${serviceName}-item2`,
      entry: path.join(__dirname, "../../backend/item2-function/index.ts"),
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

    const item2FunctionAlias = new lambda.Alias(this, "Item2FunctionAlias", {
      aliasName: functionAlias,
      version: item2Function.currentVersion,
    });

    new ssm.StringParameter(this, "item2FunctionAliasParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/lambda/v1/item2`,
      stringValue: item2FunctionAlias.functionArn,
    });
  }
}
