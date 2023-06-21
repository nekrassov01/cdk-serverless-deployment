import {
  Stack,
  StackProps,
  aws_apigateway as apig,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Common } from "./common";

const common = new Common();
const env = common.getEnvironment();
const domainName = common.getDomain();
const lambdaConfig = common.defaultConfig.lambda;
const apigatewayConfig = common.defaultConfig.apigateway;
const codebuildConfig = common.defaultConfig.codebuild;

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get function bucket from bucket name
    const functionBucket = s3.Bucket.fromBucketName(
      this,
      "FunctionBucket",
      common.getResourceName(lambdaConfig.bucket)
    );

    // Create function
    const item1FunctionAlias = common.createNodeJsFunction(this, "Item1Function", {
      functionName: "item1",
      description: "item1",
      code: lambda.Code.fromBucket(functionBucket, `backend/item1/${lambdaConfig.package}`),
      parameterStore: false,
    });
    const item2FunctionAlias = common.createNodeJsFunction(this, "Item2Function", {
      functionName: "item2",
      description: "item2",
      code: lambda.Code.fromBucket(functionBucket, `backend/item2/${lambdaConfig.package}`),
      parameterStore: false,
    });
    const item1FunctionV2Alias = common.createNodeJsFunction(this, "Item1FunctionV2", {
      functionName: "item1-v2",
      description: "item1-v2",
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item1/${lambdaConfig.package}`),
      parameterStore: false,
    });
    const item2FunctionV2Alias = common.createNodeJsFunction(this, "Item2FunctionV2", {
      functionName: "item2-v2",
      description: "item2-v2",
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item2/${lambdaConfig.package}`),
      parameterStore: false,
    });

    //// Create lambda role for v1/items/item1
    //const item1FunctionRole = new iam.Role(this, "Item1FunctionRole", {
    //  roleName: common.getResourceName("item1-function-role"),
    //  assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    //});
    //
    //// v1/items/item1
    //const item1Function = new lambda.Function(this, "Item1Function", {
    //  functionName: common.getResourceName("item1"),
    //  description: common.getResourceName("item1"),
    //  code: lambda.Code.fromBucket(functionBucket, `backend/item1/${lambdaConfig.package}`),
    //  handler: "index.handler",
    //  runtime: lambda.Runtime.NODEJS_18_X,
    //  architecture: lambda.Architecture.X86_64,
    //  currentVersionOptions: {
    //    removalPolicy: common.getRemovalPolicy(),
    //  },
    //  role: item1FunctionRole,
    //});
    //const item1FunctionAlias = new lambda.Alias(this, "Item1FunctionAlias", {
    //  aliasName: lambdaConfig.alias,
    //  version: item1Function.currentVersion,
    //});
    //
    //// Create lambda role for v1/items/item2
    //const item2FunctionRole = new iam.Role(this, "Item2FunctionRole", {
    //  roleName: common.getResourceName("item2-function-role"),
    //  assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    //});
    //
    //// v1/items/item2
    //const item2Function = new lambda.Function(this, "Item2Function", {
    //  functionName: common.getResourceName("item2"),
    //  description: common.getResourceName("item2"),
    //  code: lambda.Code.fromBucket(functionBucket, `backend/item2/${lambdaConfig.package}`),
    //  handler: "index.handler",
    //  runtime: lambda.Runtime.NODEJS_18_X,
    //  architecture: lambda.Architecture.X86_64,
    //  currentVersionOptions: {
    //    removalPolicy: common.getRemovalPolicy(),
    //  },
    //  role: item2FunctionRole,
    //});
    //const item2FunctionAlias = new lambda.Alias(this, "Item2FunctionAlias", {
    //  aliasName: lambdaConfig.alias,
    //  version: item2Function.currentVersion,
    //});
    //
    //// Create lambda role for v2/items/item1
    //const item1V2FunctionRole = new iam.Role(this, "Item1V2FunctionRole", {
    //  roleName: common.getResourceName("item1-v2-function-role"),
    //  assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    //});
    //
    //// v2/items/item1
    //const item1FunctionV2 = new lambda.Function(this, "Item1FunctionV2", {
    //  functionName: common.getResourceName("item1-v2"),
    //  description: common.getResourceName("item1-v2"),
    //  code: lambda.Code.fromBucket(functionBucket, `backend-v2/item1/${lambdaConfig.package}`),
    //  handler: "index.handler",
    //  runtime: lambda.Runtime.NODEJS_18_X,
    //  architecture: lambda.Architecture.X86_64,
    //  currentVersionOptions: {
    //    removalPolicy: common.getRemovalPolicy(),
    //  },
    //  role: item1V2FunctionRole,
    //});
    //const item1FunctionV2Alias = new lambda.Alias(this, "Item1FunctionV2Alias", {
    //  aliasName: lambdaConfig.alias,
    //  version: item1FunctionV2.currentVersion,
    //});
    //
    //// Create lambda role for v2/items/item2
    //const item2V2FunctionRole = new iam.Role(this, "Item2V2FunctionRole", {
    //  roleName: common.getResourceName("item2-v2-function-role"),
    //  assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    //});
    //
    //// v2/items/item2
    //const item2FunctionV2 = new lambda.Function(this, "Item2FunctionV2", {
    //  functionName: common.getResourceName("item2-v2"),
    //  description: common.getResourceName("item2-v2"),
    //  code: lambda.Code.fromBucket(functionBucket, `backend-v2/item2/${lambdaConfig.package}`),
    //  handler: "index.handler",
    //  runtime: lambda.Runtime.NODEJS_18_X,
    //  architecture: lambda.Architecture.X86_64,
    //  currentVersionOptions: {
    //    removalPolicy: common.getRemovalPolicy(),
    //  },
    //  role: item2V2FunctionRole,
    //});
    //const item2FunctionV2Alias = new lambda.Alias(this, "Item2FunctionV2Alias", {
    //  aliasName: lambdaConfig.alias,
    //  version: item2FunctionV2.currentVersion,
    //});

    /**
     * API Gateway
     */

    // Create log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: common.getResourceNamePath(`apigateway/${apigatewayConfig.stage}`),
      removalPolicy: common.getRemovalPolicy(),
      retention: common.getLogsRetentionDays(),
    });

    // Create REST API
    const api = new apig.RestApi(this, "RestApi", {
      restApiName: common.getResourceName("api"),
      description: `Rest API for ${common.service}`,
      deploy: true,
      retainDeployments: true,
      deployOptions: {
        stageName: apigatewayConfig.stage,
        description: `Rest API default stage for ${common.service}`,
        documentationVersion: undefined,
        accessLogDestination: new apig.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apig.AccessLogFormat.jsonWithStandardFields(),
        cachingEnabled: false,
        cacheClusterEnabled: false,
        cacheClusterSize: undefined,
        cacheTtl: undefined,
        cacheDataEncrypted: undefined,
        metricsEnabled: true,
        tracingEnabled: false,
        dataTraceEnabled: true, // Not recommended for production
        loggingLevel: apig.MethodLoggingLevel.INFO,
        throttlingBurstLimit: undefined,
        throttlingRateLimit: undefined,
        clientCertificateId: undefined,
        methodOptions: undefined,
        variables: undefined,
      },
      defaultIntegration: undefined,
      defaultMethodOptions: undefined,
      defaultCorsPreflightOptions: undefined,
      disableExecuteApiEndpoint: false,
      cloudWatchRole: true,
      endpointTypes: [apig.EndpointType.EDGE],
      endpointConfiguration: undefined,
      endpointExportName: undefined,
      failOnWarnings: true,
      minCompressionSize: undefined,
      apiKeySourceType: undefined,
      binaryMediaTypes: undefined,
      cloneFrom: undefined,
      parameters: undefined,
    });

    // Define default lambda integration options
    const defaultIntegrationOptions: apig.LambdaIntegrationOptions = {
      allowTestInvoke: true,
      cacheKeyParameters: undefined,
      cacheNamespace: undefined,
      connectionType: undefined, // Define this and for some reason it detects drift
      contentHandling: undefined,
      credentialsPassthrough: undefined,
      credentialsRole: undefined,
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Headers":
              "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            "method.response.header.Access-Control-Allow-Origin": "'*'",
            "method.response.header.Access-Control-Allow-Methods": "'OPTIONS,POST,GET,PUT,DELETE'",
          },
        },
      ],
      passthroughBehavior: apig.PassthroughBehavior.WHEN_NO_MATCH,
      proxy: true,
      requestParameters: undefined,
      requestTemplates: undefined,
      timeout: undefined,
      vpcLink: undefined,
    };

    const defaultMethodresponse: apig.MethodResponse = {
      statusCode: "200",
      responseParameters: {
        "method.response.header.Access-Control-Allow-Headers": true,
        "method.response.header.Access-Control-Allow-Methods": true,
        "method.response.header.Access-Control-Allow-Origin": true,
      },
    };

    // Create api resources: v1
    const v1 = api.root.addResource("v1");
    const items = v1.addResource("items");
    const item1 = items.addResource("item1");
    item1.addMethod("GET", new apig.LambdaIntegration(item1FunctionAlias, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2 = items.addResource("item2");
    item2.addMethod("GET", new apig.LambdaIntegration(item2FunctionAlias, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });

    // Create api resources: v2
    const v2 = api.root.addResource("v2");
    const itemsV2 = v2.addResource("items");
    const item1V2 = itemsV2.addResource("item1");
    item1V2.addMethod("GET", new apig.LambdaIntegration(item1FunctionV2Alias, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2V2 = itemsV2.addResource("item2");
    item2V2.addMethod("GET", new apig.LambdaIntegration(item2FunctionV2Alias, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });

    // Create function permission for api `v1/items/item1/`
    new lambda.CfnPermission(this, "Item1Permission", {
      action: "lambda:InvokeFunction",
      functionName: item1FunctionAlias.functionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v1/items/item1", api.deploymentStage.stageName),
    });

    // Create function permission for api `v1/items/item2/`
    new lambda.CfnPermission(this, "Item2Permission", {
      action: "lambda:InvokeFunction",
      functionName: item2FunctionAlias.functionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v1/items/item2", api.deploymentStage.stageName),
    });

    // Create function permission for api `v2/items/item1/`
    new lambda.CfnPermission(this, "Item1PermissionV2", {
      action: "lambda:InvokeFunction",
      functionName: item1FunctionV2Alias.functionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v2/items/item1", api.deploymentStage.stageName),
    });

    // Create function permission for api `v2/items/item2/`
    new lambda.CfnPermission(this, "Item2PermissionV2", {
      action: "lambda:InvokeFunction",
      functionName: item2FunctionV2Alias.functionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v2/items/item2", api.deploymentStage.stageName),
    });

    // Put rest api to SSM parameter store
    new ssm.StringParameter(this, "ApiParameter", {
      parameterName: common.getResourceNamePath("apigateway"),
      stringValue: api.restApiId,
    });
  }
}
