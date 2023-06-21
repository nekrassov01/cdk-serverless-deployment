import {
  Stack,
  StackProps,
  aws_codebuild as codebuild,
  aws_codecommit as codecommit,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as codepipeline_actions,
  aws_events as events,
  aws_events_targets as events_targets,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sns as sns,
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

const sourceStageName = "Source";
const buildStageName = "Build";
const deployStageName = "Deploy";
const approveStageName = "Approve";
const promoteStageName = "Promote";

export class CicdStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /**
     * Get parameters
     */

    // Get function bucket
    const functionBucket = s3.Bucket.fromBucketName(
      this,
      "FunctionBucket",
      common.getResourceName(lambdaConfig.bucket)
    );

    // Get hosting bucket
    const hostingBucketName = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      common.getResourceNamePath("s3/website"),
      ssm.ParameterValueType.STRING
    );
    const hostingBucket = s3.Bucket.fromBucketName(this, "HostingBucket", hostingBucketName);

    // Get cloudfront log bucket
    const cloudfrontLogBucketName = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      common.getResourceNamePath("s3/cloudfront-log"),
      ssm.ParameterValueType.STRING
    );
    const cloudfrontLogBucket = s3.Bucket.fromBucketName(this, "CloudFrontLogBucket", cloudfrontLogBucketName);

    // Get cloudfront distribution id
    const distributionId = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      common.getResourceNamePath("cloudfront/cfcd-production"),
      ssm.ParameterValueType.STRING
    );

    // Get codecommit repository
    const codeCommitRepository = codecommit.Repository.fromRepositoryName(
      this,
      "CodeCommitRepository",
      common.repository
    );

    // codepipeline artifact output
    const sourceOutput = new codepipeline.Artifact(sourceStageName);
    const buildOutput = new codepipeline.Artifact(buildStageName);
    const deployOutput = new codepipeline.Artifact(deployStageName);

    /**
     * Frontend pipeline
     */

    //const frontendArtifactBucket = new s3.Bucket(this, "FrontendArtifactBucket", {
    //  bucketName: common.getResourceName("pipeline-artifact-frontend"),
    //  encryption: s3.BucketEncryption.S3_MANAGED,
    //  enforceSSL: true,
    //  removalPolicy: RemovalPolicy.DESTROY,
    //  autoDeleteObjects: true,
    //});

    // Create s3 bucket for frontend pipeline artifact
    const frontendArtifactBucket = common.createBucket(this, "FrontendArtifactBucket", {
      bucketName: "pipeline-artifact-frontend",
      lifecycle: true,
      parameterStore: false,
      objectOwnership: false,
    });

    // Create codebuild project role for frontend build
    const frontendBuildProjectRole = new iam.Role(this, "FrontendBuildProjectRole", {
      roleName: common.getResourceName("frontend-build-project-role"),
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });

    // Create codebuild project for frontend build
    const frontendBuildProject = new codebuild.PipelineProject(this, "FrontendBuildProject", {
      projectName: common.getResourceName("frontend-build-project"),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(`${codebuildConfig.localDir}/buildspec.frontend.build.yml`),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE: { value: common.service },
        ENVIRONMENT: { value: common.environment },
        BRANCH: { value: common.branch },
        REACT_APP_BACKEND_DOMAIN: { value: domainName },
        REACT_APP_BACKEND_STAGE: { value: apigatewayConfig.stage },
      },
      badge: false,
      role: frontendBuildProjectRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "FrontendBuildProjectLogGroup", {
            logGroupName: common.getResourceNamePath("codebuild/frontend-build-project"),
            removalPolicy: common.getRemovalPolicy(),
            retention: common.getLogsRetentionDays(),
          }),
        },
      },
    });

    // Create codebuild project role for frontend deploy
    const frontendDeployProjectRole = new iam.Role(this, "FrontendDeployProjectRole", {
      roleName: common.getResourceName("frontend-deploy-project-role"),
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        ["FrontendDeployProjectRoleAdditionalPolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:GetParameter", "ssm:PutParameter"],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${common.getResourceNamePath("*")}`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
              resources: [hostingBucket.bucketArn, hostingBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
              resources: [cloudfrontLogBucket.bucketArn, cloudfrontLogBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudfront:GetDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:CreateDistribution",
                "cloudfront:UpdateDistribution",
                "cloudfront:CopyDistribution",
                "cloudfront:GetInvalidation",
                "cloudfront:CreateInvalidation",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudfront:CreateContinuousDeploymentPolicy"],
              resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["wafv2:GetWebACL"],
              resources: [env.webAcl],
            }),
          ],
        }),
      },
    });

    // Create codebuild project for frontend deploy
    const frontendDeployProject = new codebuild.PipelineProject(this, "FrontendDeployProject", {
      projectName: common.getResourceName("frontend-deploy-project"),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(`${codebuildConfig.localDir}/buildspec.frontend.deploy.yml`),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE: { value: common.service },
        ENVIRONMENT: { value: common.environment },
        BRANCH: { value: common.branch },
        BUCKET_NAME: { value: hostingBucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: frontendDeployProjectRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "FrontendDeployProjectLogGroup", {
            logGroupName: common.getResourceNamePath("codebuild/frontend-deploy-project"),
            removalPolicy: common.getRemovalPolicy(),
            retention: common.getLogsRetentionDays(),
          }),
        },
      },
    });

    // Create codebuild project role for frontend promote
    const frontendPromoteProjectRole = new iam.Role(this, "FrontendPromoteProjectRole", {
      roleName: common.getResourceName("frontend-promote-project-role"),
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        ["FrontendPromoteProjectRoleAdditionalPolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:GetParameter", "ssm:PutParameter"],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${common.getResourceNamePath("*")}`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
              resources: [cloudfrontLogBucket.bucketArn, cloudfrontLogBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudfront:GetDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:DeleteDistribution",
                "cloudfront:UpdateDistribution",
                "cloudfront:GetInvalidation",
                "cloudfront:CreateInvalidation",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudfront:GetContinuousDeploymentPolicy", "cloudfront:DeleteContinuousDeploymentPolicy"],
              resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["wafv2:GetWebACL"],
              resources: [env.webAcl],
            }),
          ],
        }),
      },
    });

    // Create codebuild project for frontend promote
    const frontendPromoteProject = new codebuild.PipelineProject(this, "FrontendPromoteProject", {
      projectName: common.getResourceName("frontend-promote-project"),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(`${codebuildConfig.localDir}/buildspec.frontend.promote.yml`),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE: { value: common.service },
        ENVIRONMENT: { value: common.environment },
        BRANCH: { value: common.branch },
        BUCKET_NAME: { value: hostingBucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: frontendPromoteProjectRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "FrontendPromoteProjectLogGroup", {
            logGroupName: common.getResourceNamePath("codebuild/frontend-promote-project"),
            removalPolicy: common.getRemovalPolicy(),
            retention: common.getLogsRetentionDays(),
          }),
        },
      },
    });

    // Create codecommit role for frontend
    const frontendSourceRole = new iam.Role(this, "FrontendSourceRole", {
      roleName: common.getResourceName("frontend-source-role"),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create event role for frontend
    const frontendEventRole = new iam.Role(this, "FrontendEventRole", {
      roleName: common.getResourceName("frontend-event-role"),
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
    });

    // Create frontend pipeline action for source stage
    const frontendSourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: sourceStageName,
      role: frontendSourceRole,
      eventRole: frontendEventRole,
      repository: codeCommitRepository,
      branch: common.branch,
      output: sourceOutput,
      runOrder: 1,
      trigger: common.getPipelineTrigger(),
    });

    // Create frontend pipeline action for build stage
    const frontendBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: buildStageName,
      project: frontendBuildProject,
      input: sourceOutput,
      outputs: [buildOutput],
      runOrder: 1,
    });

    // Create frontend pipeline action for deploy stage
    const frontendDeployAction = new codepipeline_actions.CodeBuildAction({
      actionName: deployStageName,
      project: frontendDeployProject,
      input: buildOutput,
      outputs: [deployOutput],
      runOrder: 1,
    });

    // Create frontend pipeline action for approval stage
    const frontendApproveAction = new codepipeline_actions.ManualApprovalAction({
      actionName: approveStageName,
      externalEntityLink: `https://us-east-1.console.aws.amazon.com/cloudfront/v3/home#/distributions/${distributionId}`,
      additionalInformation: `Access the staging distribution with the "aws-cf-cd-staging: true" request header and test your application.
      Once approved, the production distribution configuration will be overridden with staging configuration.`,
      notificationTopic: new sns.Topic(this, "ApprovalStageNotification", {
        topicName: common.getResourceName("frontend-approval-notification"),
        displayName: common.getResourceName("frontend-approval-notification"),
      }),
      notifyEmails: common.addresses,
      runOrder: 1,
    });

    // Create frontend pipeline action for promote stage
    const frontendPromoteAction = new codepipeline_actions.CodeBuildAction({
      actionName: promoteStageName,
      project: frontendPromoteProject,
      input: deployOutput,
      outputs: undefined,
      runOrder: 1,
    });

    // Create frontend pipeline role
    const frontendPipelineRole = new iam.Role(this, "FrontendPipelineRole", {
      roleName: common.getResourceName("frontend-pipeline-role"),
      assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      inlinePolicies: {
        ["FrontendPipelineRoleAdditionalPolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
              resources: [
                frontendBuildProject.projectArn,
                frontendDeployProject.projectArn,
                frontendPromoteProject.projectArn,
              ],
            }),
          ],
        }),
      },
    });

    // Create frontend pipeline
    const frontendPipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: common.getResourceName("frontend-pipeline"),
      role: frontendPipelineRole,
      artifactBucket: frontendArtifactBucket,
      stages: [
        {
          stageName: sourceStageName,
          actions: [frontendSourceAction],
        },
        {
          stageName: buildStageName,
          actions: [frontendBuildAction],
        },
        {
          stageName: deployStageName,
          actions: [frontendDeployAction],
        },
        {
          stageName: approveStageName,
          actions: [frontendApproveAction],
        },
        {
          stageName: promoteStageName,
          actions: [frontendPromoteAction],
        },
      ],
    });

    // Add policy to frontend artifact bucket
    frontendArtifactBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(frontendEventRole.roleArn),
          new iam.ArnPrincipal(frontendBuildProjectRole.roleArn),
          new iam.ArnPrincipal(frontendDeployProjectRole.roleArn),
          new iam.ArnPrincipal(frontendPromoteProjectRole.roleArn),
          new iam.ArnPrincipal(frontendPipelineRole.roleArn),
        ],
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [frontendArtifactBucket.bucketArn, frontendArtifactBucket.bucketArn + "/*"],
      })
    );

    // Create codebuild project role when approval failed
    const frontendCleanupProjectRole = new iam.Role(this, "FrontendCleanupProjectRole", {
      roleName: common.getResourceName("frontend-cleanup-project-role"),
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        ["FrontendCleanupProjectRoleAdditionalPolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["ssm:GetParameter", "ssm:PutParameter"],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${common.getResourceNamePath("*")}`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
              resources: [cloudfrontLogBucket.bucketArn, cloudfrontLogBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudfront:GetDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:DeleteDistribution",
                "cloudfront:UpdateDistribution",
                "cloudfront:GetInvalidation",
                "cloudfront:CreateInvalidation",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudfront:GetContinuousDeploymentPolicy", "cloudfront:DeleteContinuousDeploymentPolicy"],
              resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["wafv2:GetWebACL"],
              resources: [env.webAcl],
            }),
          ],
        }),
      },
    });

    // Create codebuild project when approval failed
    const frontendCleanupProject = new codebuild.Project(this, "FrontendCleanupProject", {
      projectName: common.getResourceName("frontend-cleanup-project"),
      source: codebuild.Source.codeCommit({
        repository: codeCommitRepository,
        branchOrRef: common.branch,
        cloneDepth: 1,
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(`${codebuildConfig.localDir}/buildspec.frontend.cleanup.yml`),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE: { value: common.service },
        ENVIRONMENT: { value: common.environment },
        BRANCH: { value: common.branch },
        BUCKET_NAME: { value: hostingBucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: frontendCleanupProjectRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "FrontendCleanupProjectLogGroup", {
            logGroupName: common.getResourceNamePath("codebuild/frontend-cleanup-project"),
            removalPolicy: common.getRemovalPolicy(),
            retention: common.getLogsRetentionDays(),
          }),
        },
      },
    });

    // Create eventbridge rule when approval failed
    new events.Rule(this, "EventHookRule", {
      enabled: true,
      ruleName: common.getResourceName("frontend-pipeline-hook"),
      eventPattern: {
        source: ["aws.codepipeline"],
        detailType: ["CodePipeline Action Execution State Change"],
        resources: [frontendPipeline.pipelineArn],
        detail: {
          stage: [approveStageName],
          action: [approveStageName],
          state: ["FAILED"],
        },
      },
      targets: [new events_targets.CodeBuildProject(frontendCleanupProject)],
    });

    /**
     * Backend pipeline
     */

    // Create s3 bucket for backend pipeline artifact
    const backendArtifactBucket = common.createBucket(this, "BackendArtifactBucket", {
      bucketName: "pipeline-artifact-backend",
      lifecycle: true,
      parameterStore: false,
      objectOwnership: false,
    });

    // Create backend pipelines
    for (const item of common.functions) {
      const functionName = common.convertKebabToPascalCase(item.functionName);

      // Create codebuild project role for backend
      const backendDeployProjectRole = new iam.Role(this, `${functionName}DeployProjectRole`, {
        roleName: common.getResourceName(`${item.functionName}-deploy-project-role`),
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
        inlinePolicies: {
          [`${functionName}DeployProjectRoleAdditionalPolicy`]: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["s3:GetObject", "s3:PutObject"],
                resources: [functionBucket.bucketArn, functionBucket.bucketArn + "/*"],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["lambda:UpdateFunctionCode", "lambda:UpdateAlias"],
                resources: [
                  `arn:aws:lambda:${this.region}:${this.account}:function:${common.getResourceName(item.functionName)}`,
                ],
              }),
            ],
          }),
        },
      });

      // Create codebuild project for backend
      const backendDeployProject = new codebuild.PipelineProject(this, `${functionName}DeployProject`, {
        projectName: common.getResourceName(`${item.functionName}-deploy-project`),
        buildSpec: codebuild.BuildSpec.fromSourceFilename(`${codebuildConfig.localDir}/buildspec.backend.yml`),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        },
        environmentVariables: {
          SERVICE_NAME: { value: common.service },
          ENVIRONMENT_NAME: { value: common.environment },
          BRANCH: { value: common.branch },
          BUCKET_NAME: { value: lambdaConfig.bucket },
          BUCKET_PATH: { value: item.bucketPath },
          FUNCTION_NAME: { value: common.getResourceName(item.functionName) },
          FUNCTION_ALIAS: { value: lambdaConfig.alias },
          FUNCTION_PACKAGE_NAME: { value: lambdaConfig.package },
        },
        badge: false,
        role: backendDeployProjectRole,
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, `${functionName}DeployProjectLogGroup`, {
              logGroupName: common.getResourceNamePath(`codebuild/${item.functionName}-deploy-project`),
              removalPolicy: common.getRemovalPolicy(),
              retention: common.getLogsRetentionDays(),
            }),
          },
        },
      });

      // Create codecommit role for backend
      const backendSourceRole = new iam.Role(this, `${functionName}SourceRole`, {
        roleName: common.getResourceName(`${item.functionName}-source-role`),
        assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
      });

      // Create event role for backend
      const backendEventRole = new iam.Role(this, `${functionName}EventRole`, {
        roleName: common.getResourceName(`${item.functionName}-event-role`),
        assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
      });

      // Create backend pipeline action for source stage
      const backendSourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: sourceStageName,
        role: backendSourceRole,
        eventRole: backendEventRole,
        repository: codeCommitRepository,
        branch: common.branch,
        output: sourceOutput,
        runOrder: 1,
        trigger: common.getPipelineTrigger(),
      });

      // Create backend pipeline action for deploy stage
      const backendDeployAction = new codepipeline_actions.CodeBuildAction({
        actionName: deployStageName,
        project: backendDeployProject,
        input: sourceOutput,
        outputs: undefined,
        runOrder: 1,
      });

      // Create backend pipeline role
      const backendPipelineRole = new iam.Role(this, `${functionName}PipelineRole`, {
        roleName: common.getResourceName(`${item.functionName}-pipeline-role`),
        assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
        inlinePolicies: {
          [`${functionName}PipelineRoleAdditionalPolicy`]: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
                resources: [
                  frontendBuildProject.projectArn,
                  frontendDeployProject.projectArn,
                  frontendPromoteProject.projectArn,
                ],
              }),
            ],
          }),
        },
      });

      // Create backend pipeline
      new codepipeline.Pipeline(this, `${functionName}Pipeline`, {
        pipelineName: common.getResourceName(`${item.functionName}-pipeline`),
        role: backendPipelineRole,
        artifactBucket: backendArtifactBucket,
        stages: [
          {
            stageName: sourceStageName,
            actions: [backendSourceAction],
          },
          {
            stageName: deployStageName,
            actions: [backendDeployAction],
          },
        ],
      });

      // Add policy to backend artifact bucket
      backendArtifactBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [
            new iam.ArnPrincipal(backendSourceRole.roleArn),
            new iam.ArnPrincipal(backendDeployProjectRole.roleArn),
          ],
          actions: ["s3:GetObject", "s3:PutObject"],
          resources: [backendArtifactBucket.bucketArn, backendArtifactBucket.bucketArn + "/*"],
        })
      );
    }
  }
}
