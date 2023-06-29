import {
  Duration,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_apigateway as apig,
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
import { Common, IEnvironmentConfig, IResourceConfig } from "./common";

export interface AppStackProps extends StackProps {
  domainName: string;
  environmentConfig: IEnvironmentConfig;
  resourceConfig: IResourceConfig;
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const { environmentConfig, resourceConfig, domainName } = props;
    const common = new Common();

    /**
     * Get parameters
     */

    // Get version of application frontend from SSM parameter store
    const frontendVersion = common.getSsmParameter(this, "version/frontend");

    // Get hosted zone from context
    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: common.getHostedZone(),
    });

    // Get function bucket from bucket name
    const functionBucket = s3.Bucket.fromBucketName(
      this,
      "FunctionBucket",
      common.getResourceName(resourceConfig.lambda.bucket)
    );

    /**
     * Certificate
     */

    // Create certificate for CloudFront
    const certificate = new acm.DnsValidatedCertificate(this, "Certificate", {
      certificateName: common.getResourceName("certificate"),
      domainName: domainName,
      subjectAlternativeNames: [`*.${domainName}`],
      region: "us-east-1",
      validation: acm.CertificateValidation.fromDns(),
      cleanupRoute53Records: false, // for safety
      hostedZone: hostedZone,
    });

    /**
     * Lambda functions
     */

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

    /**
     * Hosting bucket
     */

    const hostingBucket = common.createBucket(this, "HostingBucket", {
      bucketName: "website",
      lifecycle: false,
      parameterStore: true,
      objectOwnership: false,
    });
    hostingBucket.addCorsRule({
      allowedHeaders: ["*"],
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
      allowedOrigins: [`https://${domainName}`, `https://*.${domainName}`], // Add here if you need access from external domains
      exposedHeaders: [],
      maxAge: 3000,
    });

    /**
     * CloudFront
     */

    const cloudfrontLogBucket = common.createBucket(this, "CloudFrontLogBucket", {
      bucketName: "cloudfront-log",
      lifecycle: true,
      parameterStore: true,
      objectOwnership: true,
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
    const distributionName = common.getResourceName("distribution");
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
      webAclId: environmentConfig.webAcl,
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
        [`/${api.deploymentStage.stageName}/*`]: {
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
      parameterName: common.getResourceNamePath("cloudfront/cfcd-production"),
      stringValue: distribution.distributionId,
    });
    new ssm.StringParameter(this, "CloudFrontStagingDistributionParameter", {
      parameterName: common.getResourceNamePath("cloudfront/cfcd-staging"),
      stringValue: "dummy",
    });
  }
}
