import {
  Duration,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cloudfront_origins,
  aws_iam as iam,
  aws_route53 as route53,
  aws_route53_targets as route53_targets,
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

export class HostingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * Get parameters
     */

    // Get version of application frontend from SSM parameter store
    const frontendVersion = common.getSsmParameter(this, "version/frontend");

    // Get certificate ARN from SSM parameter store
    const certificateArn = common.getSsmParameter(this, "certificate");
    const certificate = acm.Certificate.fromCertificateArn(this, "Certificate", certificateArn);

    // Get rest api from SSM parameter store
    const apiId = common.getSsmParameter(this, "apigateway");

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
      allowedOrigins: [`https://${domainName}`, `https://*.${domainName}`], // Add here if you need access from an external domain
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
      webAclId: env.webAcl,
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
        [`/${apigatewayConfig.stage}/*`]: {
          origin: new cloudfront_origins.HttpOrigin(`${apiId}.execute-api.${this.region}.${this.urlSuffix}`, {
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
      zone: route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: common.getHostedZone(),
      }),
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
