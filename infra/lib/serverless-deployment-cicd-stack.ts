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
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sns as sns,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Common, IEnvironmentConfig, IPipelineConfig, IResourceConfig, pipelineType } from "./common";

export interface CicdStackProps extends StackProps {
  service: string;
  environment: string;
  branch: string;
  repository: string;
  domainName: string;
  environmentConfig: IEnvironmentConfig;
  resourceConfig: IResourceConfig;
  pipelines: IPipelineConfig[];
  addresses: string[];
}

export class CicdStack extends Stack {
  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const {
      service,
      environment,
      branch,
      repository,
      environmentConfig,
      resourceConfig,
      domainName,
      pipelines,
      addresses,
    } = props;
    const common = new Common();
    const sourceStageName = "Source";
    const buildStageName = "Build";
    const deployStageName = "Deploy";
    const approveStageName = "Approve";
    const promoteStageName = "Promote";
    const cleanupStageName = "Cleanup";

    /**
     * Get parameters
     */

    // Get hosting bucket
    const hostingBucketName = common.getSsmParameter(this, "s3/website");
    const hostingBucket = s3.Bucket.fromBucketName(this, "HostingBucket", hostingBucketName);

    // Get cloudfront log bucket
    const cloudfrontLogBucketName = common.getSsmParameter(this, "s3/cloudfront-log");
    const cloudfrontLogBucket = s3.Bucket.fromBucketName(this, "CloudFrontLogBucket", cloudfrontLogBucketName);

    // Get cloudfront distribution id
    const distributionId = common.getSsmParameter(this, "cloudfront/cfcd-production");

    // Get function bucket
    const functionBucket = s3.Bucket.fromBucketName(
      this,
      "FunctionBucket",
      common.getResourceName(resourceConfig.lambda.bucket)
    );

    // Get codecommit repository
    const codeCommitRepository = codecommit.Repository.fromRepositoryArn(
      this,
      "CodeCommitRepository",
      `arn:aws:codecommit:${environmentConfig.region}:${environmentConfig.account}:${repository}`
    );

    /**
     * Pipeline trigger for monorepo
     */

    // Create role for pipeline trigger function
    const pipelineHandlerRole = new iam.Role(this, "PipelineHandlerRole", {
      roleName: common.getResourceName("pipeline-hander-role"),
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        ["PipelineHandlerRoleAdditionalPolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: [`arn:aws:codepipeline:${this.region}:${this.account}:*`],
              actions: [
                "codepipeline:GetPipeline",
                "codepipeline:ListPipelines",
                "codepipeline:StartPipelineExecution",
                "codepipeline:StopPipelineExecution",
              ],
            }),
          ],
        }),
      },
    });

    // Create pipeline trigger function
    const pipelineHandlerAlias = common.createLambdaFunction(this, "PipelineHandler", {
      functionName: "pipeline-handler",
      description: "Receives codecommit code change events and starts pipelines for specific directories.",
      runtime: lambda.Runtime.GO_1_X,
      handler: "main",
      code: lambda.Code.fromAsset("src/lambda/pipeline-trigger", {
        bundling: {
          image: lambda.Runtime.GO_1_X.bundlingImage,
          command: [
            "bash",
            "-c",
            [
              "export GOCACHE=/tmp/go-cache",
              "export GOPATH=/tmp/go-path",
              "GOOS=linux go build -o /asset-output/main main.go",
            ].join(" && "),
          ],
        },
      }),
      role: pipelineHandlerRole,
      environment: {
        PIPELINES: JSON.stringify(pipelines),
      },
      parameterStore: false,
    });
    codeCommitRepository.grantRead(pipelineHandlerAlias);

    // Create event rule for repository state change
    const pipelineHandlerEventRule = new events.Rule(this, "PipelineHandlerEventRule", {
      enabled: true,
      ruleName: common.getResourceName("pipeline-handler-rule"),
      eventPattern: {
        source: ["aws.codecommit"],
        detailType: ["CodeCommit Repository State Change"],
        resources: [codeCommitRepository.repositoryArn],
        detail: {
          event: ["referenceUpdated"],
          referenceName: [branch],
        },
      },
    });
    pipelineHandlerEventRule.addTarget(new events_targets.LambdaFunction(pipelineHandlerAlias));

    /**
     * Frontend pipeline
     */

    // Create frontend pipeline artifact output
    const frontendSourceOutput = new codepipeline.Artifact(sourceStageName);
    const frontendBuildOutput = new codepipeline.Artifact(buildStageName);
    const frontendDeployOutput = new codepipeline.Artifact(deployStageName);
    const frontendPromoteOutput = new codepipeline.Artifact(promoteStageName);

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
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        `${resourceConfig.codebuild.localDir}/buildspec.frontend.build.yml`
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        REACT_APP_BACKEND_DOMAIN: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: domainName,
        },
        REACT_APP_BACKEND_STAGE: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: resourceConfig.apigateway.stage,
        },
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
              actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:*`],
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
                "cloudfront:TagResource",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "cloudfront:GetContinuousDeploymentPolicy",
                "cloudfront:CreateContinuousDeploymentPolicy",
                "cloudfront:UpdateContinuousDeploymentPolicy",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["wafv2:GetWebACL"],
              resources: [environmentConfig.webAcl],
            }),
          ],
        }),
      },
    });

    // Create codebuild project for frontend deploy
    const frontendDeployProject = new codebuild.PipelineProject(this, "FrontendDeployProject", {
      projectName: common.getResourceName("frontend-deploy-project"),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        `${resourceConfig.codebuild.localDir}/buildspec.frontend.deploy.yml`
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: service,
        },
        ENVIRONMENT: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: environment,
        },
        BRANCH: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: branch,
        },
        BUCKET_NAME: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("s3/website"),
        },
        PRODUCTION_DISTRIBUTION_ID: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("cloudfront/cfcd-production"),
        },
        STAGING_DISTRIBUTION_ID: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("cloudfront/cfcd-staging"),
        },
        STAGING_DISTRIBUTION_CLEANUP_ENABLED: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: resourceConfig.cloudfront.stagingDistributionCleanupEnabled,
        },
        CONTINUOUS_DEPLOYMENT_POLICY_CUSTOM_HEADER: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: JSON.stringify(resourceConfig.cloudfront.singleHeaderConfig),
        },
        FRONTEND_VERSION: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("version/frontend"),
        },
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
              actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:*`],
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
                "cloudfront:UpdateDistribution",
                "cloudfront:GetInvalidation",
                "cloudfront:CreateInvalidation",
              ],
              resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["cloudfront:GetContinuousDeploymentPolicy"],
              resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["wafv2:GetWebACL"],
              resources: [environmentConfig.webAcl],
            }),
          ],
        }),
      },
    });

    // Create codebuild project for frontend promote
    const frontendPromoteProject = new codebuild.PipelineProject(this, "FrontendPromoteProject", {
      projectName: common.getResourceName("frontend-promote-project"),
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        `${resourceConfig.codebuild.localDir}/buildspec.frontend.promote.yml`
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        PRODUCTION_DISTRIBUTION_ID: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("cloudfront/cfcd-production"),
        },
        STAGING_DISTRIBUTION_ID: {
          type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
          value: common.getResourceNamePath("cloudfront/cfcd-staging"),
        },
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
    const frontendSourceActionRole = new iam.Role(this, "FrontendSourceActionRole", {
      roleName: common.getResourceName("frontend-source-role"),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create codebuild build project role for frontend
    const frontendBuildActionRole = new iam.Role(this, "FrontendBuildActionRole", {
      roleName: common.getResourceName(`frontend-build-action-role`),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create codebuild deploy project role for frontend
    const frontendDeployActionRole = new iam.Role(this, "FrontendDeployActionRole", {
      roleName: common.getResourceName(`frontend-deploy-action-role`),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create codebuild approve project role for frontend
    const frontendApproveActionRole = new iam.Role(this, "FrontendApproveActionRole", {
      roleName: common.getResourceName(`frontend-approve-action-role`),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create codebuild promote project role for frontend
    const frontendPromoteActionRole = new iam.Role(this, "FrontendPromoteActionRole", {
      roleName: common.getResourceName(`frontend-promote-action-role`),
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
    });

    // Create frontend pipeline action for source stage
    const frontendSourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: sourceStageName,
      repository: codeCommitRepository,
      branch: branch,
      output: frontendSourceOutput,
      role: frontendSourceActionRole,
      runOrder: 1,
      trigger: codepipeline_actions.CodeCommitTrigger.NONE,
    });

    // Create frontend pipeline action for build stag
    const frontendBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: buildStageName,
      project: frontendBuildProject,
      input: frontendSourceOutput,
      outputs: [frontendBuildOutput],
      role: frontendBuildActionRole,
      runOrder: 1,
    });

    // Create frontend pipeline action for deploy stage
    const frontendDeployAction = new codepipeline_actions.CodeBuildAction({
      actionName: deployStageName,
      project: frontendDeployProject,
      input: frontendBuildOutput,
      outputs: [frontendDeployOutput],
      role: frontendDeployActionRole,
      runOrder: 1,
    });

    // Create frontend pipeline action for approval stage
    const frontendApproveAction = new codepipeline_actions.ManualApprovalAction({
      actionName: approveStageName,
      role: frontendApproveActionRole,
      externalEntityLink: `https://us-east-1.console.aws.amazon.com/cloudfront/v3/home#/distributions/${distributionId}`,
      additionalInformation: `Access the staging distribution with the "aws-cf-cd-staging: true" request header and test your application.
      Once approved, the production distribution configuration will be overridden with staging configuration.`,
      notificationTopic: new sns.Topic(this, "ApprovalStageTopic", {
        topicName: common.getResourceName("frontend-approval-topic"),
        displayName: common.getResourceName("frontend-approval-topic"),
      }),
      notifyEmails: addresses,
      runOrder: 1,
    });

    // Create frontend pipeline action for promote stage
    const frontendPromoteAction = new codepipeline_actions.CodeBuildAction({
      actionName: promoteStageName,
      project: frontendPromoteProject,
      input: frontendDeployOutput,
      outputs: [frontendPromoteOutput],
      role: frontendPromoteActionRole,
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
    });
    frontendPipeline.addStage({
      stageName: sourceStageName,
      actions: [frontendSourceAction],
    });
    frontendPipeline.addStage({
      stageName: buildStageName,
      actions: [frontendBuildAction],
    });
    frontendPipeline.addStage({
      stageName: deployStageName,
      actions: [frontendDeployAction],
    });
    frontendPipeline.addStage({
      stageName: approveStageName,
      actions: [frontendApproveAction],
    });
    frontendPipeline.addStage({
      stageName: promoteStageName,
      actions: [frontendPromoteAction],
    });

    // Add policy to frontend artifact bucket
    frontendArtifactBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(frontendBuildProjectRole.roleArn),
          new iam.ArnPrincipal(frontendDeployProjectRole.roleArn),
          new iam.ArnPrincipal(frontendPromoteProjectRole.roleArn),
          new iam.ArnPrincipal(frontendPipelineRole.roleArn),
        ],
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [frontendArtifactBucket.bucketArn, frontendArtifactBucket.bucketArn + "/*"],
      })
    );

    /**
     * Cleanup process (if context.stagingDistributionCleanupEnabled is true)
     */

    if (resourceConfig.cloudfront.stagingDistributionCleanupEnabled) {
      // Create codebuild project role for frontend cleanup
      const frontendCleanupProjectRole = new iam.Role(this, "FrontendCleanupProjectRole", {
        roleName: common.getResourceName("frontend-cleanup-project-role"),
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
        inlinePolicies: {
          ["FrontendCleanupProjectRoleAdditionalPolicy"]: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:*`],
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
                resources: [environmentConfig.webAcl],
              }),
            ],
          }),
        },
      });

      // Create codebuild project for frontend cleanup
      const frontendCleanupProject = new codebuild.PipelineProject(this, "FrontendCleanupProject", {
        projectName: common.getResourceName("frontend-cleanup-project"),
        buildSpec: codebuild.BuildSpec.fromSourceFilename(
          `${resourceConfig.codebuild.localDir}/buildspec.frontend.cleanup.yml`
        ),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        },
        environmentVariables: {
          SERVICE: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: service,
          },
          ENVIRONMENT: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: environment,
          },
          BRANCH: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: branch,
          },
          PRODUCTION_DISTRIBUTION_ID: {
            type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
            value: common.getResourceNamePath("cloudfront/cfcd-production"),
          },
          STAGING_DISTRIBUTION_ID: {
            type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
            value: common.getResourceNamePath("cloudfront/cfcd-staging"),
          },
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

      // Add policy to frontend pipeline
      frontendPipelineRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
          resources: [frontendCleanupProject.projectArn],
        })
      );

      // Create codebuild cleanup project role for frontend
      const frontendCleanupActionRole = new iam.Role(this, "FrontendCleanupActionRole", {
        roleName: common.getResourceName(`frontend-cleanup-action-role`),
        assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
      });

      // Create cleanup action
      const frontendCleanupAction = new codepipeline_actions.CodeBuildAction({
        actionName: cleanupStageName,
        project: frontendCleanupProject,
        input: frontendPromoteOutput,
        outputs: undefined,
        role: frontendCleanupActionRole,
        runOrder: 1,
      });

      // Add stage to frontend pipeline
      frontendPipeline.addStage({
        stageName: cleanupStageName,
        actions: [frontendCleanupAction],
      });

      // Add policy to frontend artifact bucket
      frontendArtifactBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(frontendCleanupProjectRole.roleArn)],
          actions: ["s3:GetObject", "s3:PutObject"],
          resources: [frontendArtifactBucket.bucketArn, frontendArtifactBucket.bucketArn + "/*"],
        })
      );

      // Create codebuild project role when approval failed
      const frontendPurgeProjectRole = new iam.Role(this, "FrontendPurgeProjectRole", {
        roleName: common.getResourceName("frontend-purge-project-role"),
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
        inlinePolicies: {
          ["FrontendPurgeProjectRoleAdditionalPolicy"]: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:*`],
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
                actions: [
                  "cloudfront:GetContinuousDeploymentPolicy",
                  "cloudfront:DeleteContinuousDeploymentPolicy",
                  "cloudfront:ListContinuousDeploymentPolicies",
                ],
                resources: [`arn:aws:cloudfront::${this.account}:continuous-deployment-policy/*`],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["wafv2:GetWebACL"],
                resources: [environmentConfig.webAcl],
              }),
            ],
          }),
        },
      });

      // Create codebuild project when approval failed
      const frontendPurgeProject = new codebuild.Project(this, "FrontendPurgeProject", {
        projectName: common.getResourceName("frontend-purge-project"),
        source: codebuild.Source.codeCommit({
          repository: codeCommitRepository,
          branchOrRef: branch,
          cloneDepth: 1,
        }),
        buildSpec: codebuild.BuildSpec.fromSourceFilename(
          `${resourceConfig.codebuild.localDir}/buildspec.frontend.cleanup.yml`
        ),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        },
        environmentVariables: {
          SERVICE: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: service,
          },
          ENVIRONMENT: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: environment,
          },
          BRANCH: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: branch,
          },
          PRODUCTION_DISTRIBUTION_ID: {
            type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
            value: common.getResourceNamePath("cloudfront/cfcd-production"),
          },
          STAGING_DISTRIBUTION_ID: {
            type: codebuild.BuildEnvironmentVariableType.PARAMETER_STORE,
            value: common.getResourceNamePath("cloudfront/cfcd-staging"),
          },
        },
        badge: false,
        role: frontendPurgeProjectRole,
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, "FrontendPurgeProjectLogGroup", {
              logGroupName: common.getResourceNamePath("codebuild/frontend-purge-project"),
              removalPolicy: common.getRemovalPolicy(),
              retention: common.getLogsRetentionDays(),
            }),
          },
        },
      });
      // Create event role for frontend cleanup project when apploval failed
      const frontendPurgeEventRole = new iam.Role(this, "frontendPurgeEventRole", {
        roleName: common.getResourceName("frontend-purge-event-role"),
        assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
      });

      // Create eventbridge rule when approval failed
      const frontendPipelinPurgeEventRule = new events.Rule(this, "FrontendPurgeEventRule", {
        enabled: true,
        ruleName: common.getResourceName("frontend-purge-rule"),
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
      });
      frontendPipelinPurgeEventRule.addTarget(
        new events_targets.CodeBuildProject(frontendPurgeProject, {
          eventRole: frontendPurgeEventRole,
        })
      );
    }

    /**
     * Backend pipeline
     */

    // Create backend pipeline artifact output
    const backendSourceOutput = new codepipeline.Artifact(sourceStageName);
    const backendBuildOutput = new codepipeline.Artifact(buildStageName);

    // Create s3 bucket for backend pipeline artifact
    const backendArtifactBucket = common.createBucket(this, "BackendArtifactBucket", {
      bucketName: "pipeline-artifact-backend",
      lifecycle: true,
      parameterStore: false,
      objectOwnership: false,
    });

    // Create backend pipelines

    for (const pipeline of common.getPipelineConfigByType(pipelineType.Backend)) {
      const functionName = Common.convertKebabToPascalCase(pipeline.name);

      // Create codebuild project role for backend
      const backendBuildProjectRole = new iam.Role(this, `${functionName}BuildProjectRole`, {
        roleName: common.getResourceName(`${pipeline.name}-build-project-role`),
        assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      });

      // Create codebuild project for backend
      const backendBuildProject = new codebuild.PipelineProject(this, `${functionName}BuildProject`, {
        projectName: common.getResourceName(`${pipeline.name}-build-project`),
        buildSpec: codebuild.BuildSpec.fromSourceFilename(
          `${resourceConfig.codebuild.localDir}/buildspec.backend.build.yml`
        ),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        },
        environmentVariables: {
          TARGET_PATH: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: pipeline.path,
          },
        },
        badge: false,
        role: backendBuildProjectRole,
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, `${functionName}BuildProjectLogGroup`, {
              logGroupName: common.getResourceNamePath(`codebuild/${pipeline.name}-build-project`),
              removalPolicy: common.getRemovalPolicy(),
              retention: common.getLogsRetentionDays(),
            }),
          },
        },
      });

      // Create codebuild project role for backend
      const backendDeployProjectRole = new iam.Role(this, `${functionName}DeployProjectRole`, {
        roleName: common.getResourceName(`${pipeline.name}-deploy-project-role`),
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
                actions: [
                  "lambda:GetFunction",
                  "lambda:UpdateFunctionCode",
                  "lambda:UpdateAlias",
                  "lambda:TagResource",
                ],
                resources: [
                  `arn:aws:lambda:${this.region}:${this.account}:function:${common.getResourceName(pipeline.name)}`,
                ],
              }),
            ],
          }),
        },
      });

      // Create codebuild project for backend
      const backendDeployProject = new codebuild.PipelineProject(this, `${functionName}DeployProject`, {
        projectName: common.getResourceName(`${pipeline.name}-deploy-project`),
        buildSpec: codebuild.BuildSpec.fromSourceFilename(
          `${resourceConfig.codebuild.localDir}/buildspec.backend.deploy.yml`
        ),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        },
        environmentVariables: {
          SERVICE: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: service,
          },
          ENVIRONMENT: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: environment,
          },
          BRANCH: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: branch,
          },
          TARGET_PATH: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: pipeline.path,
          },
          BUCKET_NAME: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: common.getResourceName(resourceConfig.lambda.bucket),
          },
          FUNCTION_NAME: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: common.getResourceName(pipeline.name),
          },
          FUNCTION_ALIAS: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: resourceConfig.lambda.alias,
          },
          FUNCTION_PACKAGE_NAME: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: resourceConfig.lambda.package,
          },
        },
        badge: false,
        role: backendDeployProjectRole,
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, `${functionName}DeployProjectLogGroup`, {
              logGroupName: common.getResourceNamePath(`codebuild/${pipeline.name}-deploy-project`),
              removalPolicy: common.getRemovalPolicy(),
              retention: common.getLogsRetentionDays(),
            }),
          },
        },
      });

      // Create codecommit role for backend
      const backendSourceActionRole = new iam.Role(this, `${functionName}SourceActionRole`, {
        roleName: common.getResourceName(`${pipeline.name}-source-role`),
        assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
      });

      // Create codebuild build project role for backend
      const backendBuildActionRole = new iam.Role(this, `${functionName}BuildActionRole`, {
        roleName: common.getResourceName(`${pipeline.name}-build-action-role`),
        assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
      });

      // Create codebuild deploy project role for backend
      const backendDeployActionRole = new iam.Role(this, `${functionName}DeployActionRole`, {
        roleName: common.getResourceName(`${pipeline.name}-deploy-action-role`),
        assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`),
      });

      // Create backend pipeline action for source stage
      const backendSourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: sourceStageName,
        repository: codeCommitRepository,
        branch: branch,
        output: backendSourceOutput,
        role: backendSourceActionRole,
        runOrder: 1,
        trigger: codepipeline_actions.CodeCommitTrigger.NONE,
      });

      // Create backend pipeline action for build stage
      const backendBuildAction = new codepipeline_actions.CodeBuildAction({
        actionName: buildStageName,
        project: backendBuildProject,
        input: backendSourceOutput,
        outputs: [backendBuildOutput],
        role: backendBuildActionRole,
        runOrder: 1,
      });

      // Create backend pipeline action for deploy stage
      const backendDeployAction = new codepipeline_actions.CodeBuildAction({
        actionName: deployStageName,
        project: backendDeployProject,
        input: backendBuildOutput,
        outputs: undefined,
        role: backendDeployActionRole,
        runOrder: 1,
      });

      // Create backend pipeline role
      const backendPipelineRole = new iam.Role(this, `${functionName}PipelineRole`, {
        roleName: common.getResourceName(`${pipeline.name}-pipeline-role`),
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
        pipelineName: common.getResourceName(`${pipeline.name}-pipeline`),
        role: backendPipelineRole,
        artifactBucket: backendArtifactBucket,
        stages: [
          {
            stageName: sourceStageName,
            actions: [backendSourceAction],
          },
          {
            stageName: buildStageName,
            actions: [backendBuildAction],
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
          principals: [new iam.ArnPrincipal(backendDeployProjectRole.roleArn)],
          actions: ["s3:GetObject", "s3:PutObject"],
          resources: [backendArtifactBucket.bucketArn, backendArtifactBucket.bucketArn + "/*"],
        })
      );
    }
  }
}
