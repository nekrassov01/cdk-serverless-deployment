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
import { Common, IResourceConfig } from "./common";

export interface ApiStackProps extends StackProps {
  resourceConfig: IResourceConfig;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { resourceConfig } = props;
    const common = new Common();

    // Get function bucket from bucket name
    const functionBucket = s3.Bucket.fromBucketName(
      this,
      "FunctionBucket",
      common.getResourceName(resourceConfig.lambda.bucket)
    );

    // Create function
    const item1FunctionAlias = common.createLambdaFunction(this, "Item1Function", {
      functionName: "item1",
      description: "item1",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromBucket(functionBucket, `backend/item1/${resourceConfig.lambda.package}`),
      parameterStore: false,
    });
    const item2FunctionAlias = common.createLambdaFunction(this, "Item2Function", {
      functionName: "item2",
      description: "item2",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromBucket(functionBucket, `backend/item2/${resourceConfig.lambda.package}`),
      parameterStore: false,
    });
    const item1FunctionV2Alias = common.createLambdaFunction(this, "Item1FunctionV2", {
      functionName: "item1-v2",
      description: "item1-v2",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item1/${resourceConfig.lambda.package}`),
      parameterStore: false,
    });
    const item2FunctionV2Alias = common.createLambdaFunction(this, "Item2FunctionV2", {
      functionName: "item2-v2",
      description: "item2-v2",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromBucket(functionBucket, `backend-v2/item2/${resourceConfig.lambda.package}`),
      parameterStore: false,
    });

    /**
     * API Gateway
     */

    // Create log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: common.getResourceNamePath(`apigateway/${resourceConfig.apigateway.stage}`),
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
        stageName: resourceConfig.apigateway.stage,
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

    // Put api id to SSM parameter store
    new ssm.StringParameter(this, "RestApiParameter", {
      parameterName: common.getResourceNamePath("apigateway"),
      stringValue: api.restApiId,
    });
  }
}
