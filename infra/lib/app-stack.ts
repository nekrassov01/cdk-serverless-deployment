import {
  App,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_apigateway as apigw,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cloudfront_origins,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as route53_targets,
  aws_s3 as s3,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const app = new App();

const serviceName = app.node.tryGetContext("serviceName");
const environmentName = app.node.tryGetContext("environmentName");
const branch = app.node.tryGetContext("branch");
const hostedZoneName = app.node.tryGetContext("domain");
const domainName = `${serviceName}.${hostedZoneName}`;
const webAclArn = app.node.tryGetContext("webAclArn");

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * Get parameters
     */

    // Get version of application frontend from SSM parameter store
    const frontendVersion = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/version/frontend`,
      ssm.ParameterValueType.STRING
    );

    // Get certificate ARN from SSM parameter store
    const certificateArn = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/certificate`,
      ssm.ParameterValueType.STRING
    );
    const certificate = acm.Certificate.fromCertificateArn(this, "Certificate", certificateArn);

    // Get route53 hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: hostedZoneName,
    });

    // Get function: v1, item1
    const item1FunctionArn = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/lambda/v1/item1`,
      ssm.ParameterValueType.STRING
    );
    const item1Function = lambda.Function.fromFunctionArn(this, "Item1FunctionArn", item1FunctionArn);

    // Get function: v1, item2
    const item2FunctionArn = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/lambda/v1/item2`,
      ssm.ParameterValueType.STRING
    );
    const item2Function = lambda.Function.fromFunctionArn(this, "Item2FunctionArn", item2FunctionArn);

    // Get function: v2, item1
    const item1FunctionArnV2 = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/lambda/v2/item1`,
      ssm.ParameterValueType.STRING
    );
    const item1FunctionV2 = lambda.Function.fromFunctionArn(this, "Item1FunctionArnV2", item1FunctionArnV2);

    // Get function: v2, item2
    const item2FunctionArnV2 = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/lambda/v2/item2`,
      ssm.ParameterValueType.STRING
    );
    const item2FunctionV2 = lambda.Function.fromFunctionArn(this, "Item2FunctionArnV2", item2FunctionArnV2);

    /**
     * API Gateway
     */

    const stageName = "default";

    // Create log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `${serviceName}/apigateway/${stageName}/log`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_DAYS,
    });

    // Create REST API
    const api = new apigw.RestApi(this, "RestApi", {
      restApiName: `${serviceName}-rest-api`,
      description: `Rest API for ${serviceName}`,
      deploy: true,
      retainDeployments: true,
      deployOptions: {
        stageName: stageName,
        description: `Rest API default stage for ${serviceName}`,
        documentationVersion: undefined,
        accessLogDestination: new apigw.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        cachingEnabled: false,
        cacheClusterEnabled: false,
        cacheClusterSize: undefined,
        cacheTtl: undefined,
        cacheDataEncrypted: undefined,
        metricsEnabled: true,
        tracingEnabled: false,
        dataTraceEnabled: true, // Not recommended for production
        loggingLevel: apigw.MethodLoggingLevel.INFO,
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
      //  endpointType: apigw.EndpointType.EDGE,
      //  securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      //  mtls: undefined,
      //},
      endpointTypes: [apigw.EndpointType.EDGE],
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
    const defaultIntegrationOptions: apigw.LambdaIntegrationOptions = {
      allowTestInvoke: true,
      cacheKeyParameters: undefined,
      cacheNamespace: undefined,
      connectionType: apigw.ConnectionType.INTERNET,
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
      passthroughBehavior: apigw.PassthroughBehavior.WHEN_NO_MATCH,
      proxy: true,
      requestParameters: undefined,
      requestTemplates: undefined,
      timeout: undefined,
      vpcLink: undefined,
    };

    const defaultMethodresponse: apigw.MethodResponse = {
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
    item1.addMethod("GET", new apigw.LambdaIntegration(item1Function, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2 = items.addResource("item2");
    item2.addMethod("GET", new apigw.LambdaIntegration(item2Function, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });

    // Create api resources: v2
    const v2 = api.root.addResource("v2");
    const itemsV2 = v2.addResource("items");
    const item1V2 = itemsV2.addResource("item1");
    item1V2.addMethod("GET", new apigw.LambdaIntegration(item1FunctionV2, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });
    const item2V2 = itemsV2.addResource("item2");
    item2V2.addMethod("GET", new apigw.LambdaIntegration(item2FunctionV2, defaultIntegrationOptions), {
      methodResponses: [defaultMethodresponse],
    });

    // Create function permission for api `v1/items/item1/`
    new lambda.CfnPermission(this, "Item1Permission", {
      action: "lambda:InvokeFunction",
      functionName: item1FunctionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v1/items/item1", api.deploymentStage.stageName),
    });

    // Create function permission for api `v1/items/item2/`
    new lambda.CfnPermission(this, "Item2Permission", {
      action: "lambda:InvokeFunction",
      functionName: item2FunctionArn,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v1/items/item2", api.deploymentStage.stageName),
    });

    // Create function permission for api `v2/items/item1/`
    new lambda.CfnPermission(this, "Item1PermissionV2", {
      action: "lambda:InvokeFunction",
      functionName: item1FunctionArnV2,
      principal: "apigateway.amazonaws.com",
      sourceArn: api.arnForExecuteApi("GET", "/v2/items/item1", api.deploymentStage.stageName),
    });

    // Create function permission for api `v2/items/item2/`
    new lambda.CfnPermission(this, "Item2PermissionV2", {
      action: "lambda:InvokeFunction",
      functionName: item2FunctionArnV2,
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

    /**
     * Hosting bucket
     */

    // Create hosting bucket
    const hostingBucket = new s3.Bucket(this, "HostingBucket", {
      bucketName: `${serviceName}-website`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      //websiteIndexDocument: "index.html", // error if this is present
      //websiteErrorDocument: "index.html", // same as above
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: [`https://${domainName}`, `https://*.${domainName}`],
          exposedHeaders: [],
          maxAge: 3000,
        },
      ],
    });

    /**
     * CloudFront
     */

    // Create CloudFront accesslog bucket
    const cloudfrontLogBucket = new s3.Bucket(this, "CloudFrontLogBucket", {
      bucketName: `${serviceName}-cloudfront-log`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // required in cloudfront accesslog bucket
    });

    // Create OriginAccessControl
    const hostingOac = new cloudfront.CfnOriginAccessControl(this, "HostingOac", {
      originAccessControlConfig: {
        name: hostingBucket.bucketDomainName,
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4",
        description: hostingBucket.bucketDomainName,
      },
    });

    // Create CloudFront distribution
    // NOTE: CloudFront continuous deployment does not support HTTP3
    const distributionName = `${serviceName}-distribution`;
    const indexPage = "index.html";
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      enabled: true,
      comment: distributionName,
      domainNames: [domainName],
      defaultRootObject: indexPage,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      certificate: certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableIpv6: false,
      enableLogging: true,
      logBucket: cloudfrontLogBucket,
      logFilePrefix: distributionName,
      logIncludesCookies: true,
      webAclId: webAclArn,
      defaultBehavior: {
        origin: new cloudfront_origins.S3Origin(hostingBucket, {
          originPath: `/${frontendVersion}`,
          connectionAttempts: 3,
          connectionTimeout: Duration.seconds(10),
        }),
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        //cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // cache disabling for test
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        smoothStreaming: false,
      },
      additionalBehaviors: {
        [`/${stageName}/*`]: {
          origin: new cloudfront_origins.RestApiOrigin(api, {
            originPath: undefined,
            connectionAttempts: 3,
            connectionTimeout: Duration.seconds(10),
            readTimeout: Duration.seconds(30),
            keepaliveTimeout: Duration.seconds(5),
          }),
          compress: false,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          smoothStreaming: false,
        },
        //errorResponses: [
        //  {
        //    ttl: Duration.seconds(0),
        //    httpStatus: 403,
        //    responseHttpStatus: 200,
        //    responsePagePath: `/${indexPage}`,
        //  },
        //  {
        //    ttl: Duration.seconds(0),
        //    httpStatus: 404,
        //    responseHttpStatus: 200,
        //    responsePagePath: `/${indexPage}`,
        //  },
        //],
      },
    });

    // Override L1 properties
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.Id", "hosting-bucket");
    cfnDistribution.addPropertyOverride("DistributionConfig.DefaultCacheBehavior.TargetOriginId", "hosting-bucket");
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity", "");
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.OriginAccessControlId", hostingOac.attrId);
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.1.Id", "api");
    cfnDistribution.addPropertyOverride("DistributionConfig.CacheBehaviors.0.TargetOriginId", "api");

    // Create policy for hosting bucket
    const hostingBucketPolicyStatement = new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
      effect: iam.Effect.ALLOW,
      resources: [`${hostingBucket.bucketArn}/*`],
      actions: ["s3:GetObject"],
    });
    hostingBucketPolicyStatement.addCondition("StringEquals", {
      "AWS:SourceAccount": this.account,
    });

    // Add bucket policy to hosting bucket
    hostingBucket.addToResourcePolicy(hostingBucketPolicyStatement);

    //// Deploy default items for website hosting bucket
    //new s3deploy.BucketDeployment(this, "HostingBucketDeployment", {
    //  sources: [s3deploy.Source.asset("src/s3/hosting-bucket/react-deployment-sample/build")],
    //  destinationBucket: hostingBucket,
    //  destinationKeyPrefix: frontendVersion,
    //  distribution: distribution,
    //  distributionPaths: ["/*"],
    //  prune: true,
    //  logRetention: logs.RetentionDays.THREE_DAYS,
    //});

    // Alias record for CloudFront
    const distributionARecord = new route53.ARecord(this, "DistributionARecord", {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new route53_targets.CloudFrontTarget(distribution)),
      zone: hostedZone,
    });
    distributionARecord.node.addDependency(distribution);

    /**
     * Put parameters
     */

    // Put distributionId to SSM parameter store
    new ssm.StringParameter(this, "CloudFrontProductionDistributionParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/cloudfront/cfcd-production`,
      stringValue: distribution.distributionId,
    });
    new ssm.StringParameter(this, "CloudFrontStagingDistributionParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/cloudfront/cfcd-staging`,
      stringValue: "dummy",
    });

    // Put bucketName to SSM parameter store
    new ssm.StringParameter(this, "HostingBucketParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/s3/hosting-bucket`,
      stringValue: hostingBucket.bucketName,
    });

    // Put api domainName/stageName to SSM parameter store
    new ssm.StringParameter(this, "RestApiParameter", {
      parameterName: `/${serviceName}/${environmentName}/${branch}/apigateway/stage`,
      stringValue: api.deploymentStage.stageName,
    });
  }
}
