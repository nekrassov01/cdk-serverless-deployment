import {
  App,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigateway as apig,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const app = new App();

const serviceName = app.node.tryGetContext("serviceName");
const environmentName = app.node.tryGetContext("environmentName");
const branch = app.node.tryGetContext("branch");
const functionBucketName = app.node.tryGetContext("functionBucketName");
const functionAlias = app.node.tryGetContext("functionAlias");
const functionPackageName = app.node.tryGetContext("functionPackageName");
const apiDefaultStageName = app.node.tryGetContext("apiDefaultStageName");

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get interface of function bucket from bucket name
    const functionBucket = s3.Bucket.fromBucketName(this, "FunctionBucket", functionBucketName);

    // v1/items/item1
    const item1Function = new lambda.Function(this, "Item1Function", {
      functionName: `${serviceName}-item1`,
      code: lambda.Code.fromBucket(functionBucket, `backend/item1/${functionPackageName}`),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });
    const item1FunctionAlias = new lambda.Alias(this, "Item1FunctionAlias", {
      aliasName: functionAlias,
      version: item1Function.currentVersion,
    });

    // v1/items/item2
    const item2Function = new lambda.Function(this, "Item2Function", {
      functionName: `${serviceName}-item2`,
      code: lambda.Code.fromBucket(functionBucket, `backend/item2/${functionPackageName}`),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });
    const item2FunctionAlias = new lambda.Alias(this, "Item2FunctionAlias", {
      aliasName: functionAlias,
      version: item2Function.currentVersion,
    });

    // v2/items/item1
    const item1FunctionV2 = new lambda.Function(this, "Item1FunctionV2", {
      functionName: `${serviceName}-item1-v2`,
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item1/${functionPackageName}`),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });
    const item1FunctionV2Alias = new lambda.Alias(this, "Item1FunctionV2Alias", {
      aliasName: functionAlias,
      version: item1FunctionV2.currentVersion,
    });

    // v2/items/item2
    const item2FunctionV2 = new lambda.Function(this, "Item2FunctionV2", {
      functionName: `${serviceName}-item2-v2`,
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item2/${functionPackageName}`),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });
    const item2FunctionV2Alias = new lambda.Alias(this, "Item2FunctionV2Alias", {
      aliasName: functionAlias,
      version: item2FunctionV2.currentVersion,
    });

    /**
     * API Gateway
     */

    // Create log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `${serviceName}/apigateway/${apiDefaultStageName}/log`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_DAYS,
    });

    // Create REST API
    const api = new apig.RestApi(this, "RestApi", {
      restApiName: `${serviceName}-rest-api`,
      description: `Rest API for ${serviceName}`,
      deploy: true,
      retainDeployments: true,
      deployOptions: {
        stageName: apiDefaultStageName,
        description: `Rest API default stage for ${serviceName}`,
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
      //domainName: {
      //  domainName: apiDomainName,
      //  certificate: certificate,
      //  basePath: undefined,
      //  endpointType: apig.EndpointType.EDGE,
      //  securityPolicy: apig.SecurityPolicy.TLS_1_2,
      //  mtls: undefined,
      //},
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

    //const base = api.root.addResource("api");

    // Create api resources: v1
    const v1 = api.root.addResource("v1");
    const items = v1.addResource("items");
    const item1 = items.addResource("item1");
    item1.addMethod("GET", new apig.LambdaIntegration(item1Function, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2 = items.addResource("item2");
    item2.addMethod("GET", new apig.LambdaIntegration(item2Function, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });

    // Create api resources: v2
    const v2 = api.root.addResource("v2");
    const itemsV2 = v2.addResource("items");
    const item1V2 = itemsV2.addResource("item1");
    item1V2.addMethod("GET", new apig.LambdaIntegration(item1FunctionV2, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2V2 = itemsV2.addResource("item2");
    item2V2.addMethod("GET", new apig.LambdaIntegration(item2FunctionV2, defaultIntegrationOptions), {
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

    //// Alias record for apigateway
    //const apiARecord = new route53.ARecord(this, "ApiARecord", {
    //  recordName: apiDomainName,
    //  target: route53.RecordTarget.fromAlias(new route53_targets.ApiGatewayDomain(api.domainName!)),
    //  zone: hostedZone,
    //});
    //apiARecord.node.addDependency(api);

    // Put rest api to SSM parameter store
    new ssm.StringParameter(this, "RestApiIdParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/apigateway/api`,
      stringValue: api.restApiId,
    });
  }
}
