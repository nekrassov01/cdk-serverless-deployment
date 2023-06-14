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

export class Item1FunctionStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const item1Function = new lambda_nodejs.NodejsFunction(this, "Item1Function", {
      functionName: `${serviceName}-item1`,
      entry: path.join(__dirname, "../../backend/item1-function/index.ts"),
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

    const item1FunctionAlias = new lambda.Alias(this, "Item1FunctionAlias", {
      aliasName: functionAlias,
      version: item1Function.currentVersion,
    });

    new ssm.StringParameter(this, "item1FunctionAliasParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/lambda/v1/item1`,
      stringValue: item1FunctionAlias.functionArn,
    });
  }
}
