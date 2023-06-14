import {
  App,
  RemovalPolicy,
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
import * as path from "path";

const app = new App();

const serviceName = app.node.tryGetContext("serviceName");
const environmentName = app.node.tryGetContext("environmentName");
const branch = app.node.tryGetContext("branch");
const repositoryName = app.node.tryGetContext("repositoryName");
const email = app.node.tryGetContext("email");
const hostedZoneName = app.node.tryGetContext("domain");
const domainName = `${serviceName}.${hostedZoneName}`;

const sourceStageName = "Source";
const buildStageName = "Build";
const deployStageName = "Deploy";
const approveStageName = "Approve";
const promoteStageName = "Promote";

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get hosting bucket name from SSM parameter store
    const bucketName = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/s3/hosting-bucket`,
      ssm.ParameterValueType.STRING
    );

    // Get api stage name from SSM parameter store
    const apiStageName = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/apigateway/stage`,
      ssm.ParameterValueType.STRING
    );

    // Get CloudFront distribution ID from SSM parameter store
    const distributionId = ssm.StringParameter.valueForTypedStringParameterV2(
      this,
      `/${serviceName}/${environmentName}/${branch}/cloudfront/cfcd-production`,
      ssm.ParameterValueType.STRING
    );

    // Role for attaching to ClaudWatch events to detect source changes
    const eventRole = new iam.Role(this, "EventRole", {
      roleName: `${serviceName}-event-role`,
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
    });

    // Role for attaching to source action
    const codecommitRole = new iam.Role(this, "CodecommitRole", {
      roleName: `${serviceName}-codecommit-role`,
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${Stack.of(this).account}:root`),
    });

    // Role for attaching to codebuild project
    const codebuildRole = new iam.Role(this, "CodebuildRole", {
      roleName: `${serviceName}-codebuild-role`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        InlinePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:*", "ssm:*", "cloudfront:*", "wafv2:*"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // Role for attaching to pipeline
    const codepipelineRole = new iam.Role(this, "CodepipelineRole", {
      roleName: `${serviceName}-codepipeline-role`,
      assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      inlinePolicies: {
        InlinePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:GetBucketVersioning"],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // Create bucket for pipeline artifacts
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      bucketName: `${serviceName}-pipeline-artifacts`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    artifactBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(eventRole.roleArn),
          new iam.ArnPrincipal(codebuildRole.roleArn),
          new iam.ArnPrincipal(codepipelineRole.roleArn),
        ],
        actions: ["s3:*"],
        resources: [`${artifactBucket.bucketArn}`, `${artifactBucket.bucketArn}/*`],
      })
    );

    // Create subdirectories in the artifact bucket for each pipeline action
    const sourceOutput = new codepipeline.Artifact(sourceStageName);
    const buildOutput = new codepipeline.Artifact(buildStageName);
    const deployOutput = new codepipeline.Artifact(deployStageName);

    // Retrieve existing repository
    const codeCommitRepository = codecommit.Repository.fromRepositoryName(this, "CodeCommitRepository", repositoryName);

    // Create codebuild project for react build
    const buildStage = new codebuild.PipelineProject(this, "BuildStage", {
      projectName: `${serviceName}-build-stage`,
      buildSpec: codebuild.BuildSpec.fromAsset(
        path.join(__dirname, "../../scripts/build/buildspec.frontend.build.yml")
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE_NAME: { value: serviceName },
        ENVIRONMENT_NAME: { value: environmentName },
        BRANCH: { value: branch },
        REACT_APP_BACKEND_DOMAIN_NAME: { value: domainName },
        REACT_APP_BACKEND_STAGE_NAME: { value: apiStageName },
        REACT_APP_FRONTEND_VERSION: { value: "" },
      },
      badge: false,
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "BuildStageLogGroup", {
            logGroupName: `${serviceName}/build-stage`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.THREE_DAYS,
          }),
        },
      },
    });

    // Create codebuild project for deploy (s3 sync and cloudfront continuous deployment)
    const deployStage = new codebuild.PipelineProject(this, "DeployStage", {
      projectName: `${serviceName}-deploy-stage`,
      buildSpec: codebuild.BuildSpec.fromAsset(
        path.join(__dirname, "../../scripts/build/buildspec.frontend.deploy.yml")
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE_NAME: { value: serviceName },
        ENVIRONMENT_NAME: { value: environmentName },
        BRANCH: { value: branch },
        BUCKET_NAME: { value: bucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "DeployStageLogGroup", {
            logGroupName: `${serviceName}/deploy-stage`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.THREE_DAYS,
          }),
        },
      },
    });

    // Create codebuild project for cloudfront staging promotion
    const promoteStage = new codebuild.PipelineProject(this, "PromoteStage", {
      projectName: `${serviceName}-promote-stage`,
      buildSpec: codebuild.BuildSpec.fromAsset(
        path.join(__dirname, "../../scripts/build/buildspec.frontend.promote.yml")
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE_NAME: { value: serviceName },
        ENVIRONMENT_NAME: { value: environmentName },
        BRANCH: { value: branch },
        BUCKET_NAME: { value: bucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "PromoteStageLogGroup", {
            logGroupName: `${serviceName}/promote-stage`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.THREE_DAYS,
          }),
        },
      },
    });

    // Create source action for codepipeline
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: sourceStageName,
      role: codecommitRole,
      eventRole: eventRole,
      repository: codeCommitRepository,
      branch: branch,
      output: sourceOutput,
      runOrder: 1,
      trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,
    });

    // Create build action for codepipeline
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: buildStageName,
      project: buildStage,
      input: sourceOutput,
      outputs: [buildOutput],
      runOrder: 1,
    });

    // Create deploy action for codepipeline
    const deployAction = new codepipeline_actions.CodeBuildAction({
      actionName: deployStageName,
      project: deployStage,
      input: buildOutput,
      outputs: [deployOutput],
      runOrder: 1,
    });

    // Create approve action for codepipeline
    const approveAction = new codepipeline_actions.ManualApprovalAction({
      actionName: approveStageName,
      externalEntityLink: `https://us-east-1.console.aws.amazon.com/cloudfront/v3/home#/distributions/${distributionId}`,
      additionalInformation: `Access the staging distribution with the "aws-cf-cd-staging: true" request header and test your application.
      Once approved, the production distribution configuration will be overridden with staging configuration.`,
      notificationTopic: new sns.Topic(this, "ApprovalStageNotification", {
        topicName: `${serviceName}-approval-notification`,
        displayName: `${serviceName}-approval-notification`,
      }),
      notifyEmails: email,
      runOrder: 1,
    });

    // Create promote action for codepipeline
    const promoteAction = new codepipeline_actions.CodeBuildAction({
      actionName: promoteStageName,
      project: promoteStage,
      input: deployOutput,
      outputs: undefined,
      runOrder: 1,
    });

    // Create frontend pipeline
    const frontendPipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `${serviceName}-frontend-pipeline`,
      role: codepipelineRole,
      artifactBucket: artifactBucket,
      stages: [
        {
          stageName: sourceStageName,
          actions: [sourceAction],
        },
        {
          stageName: buildStageName,
          actions: [buildAction],
        },
        {
          stageName: deployStageName,
          actions: [deployAction],
        },
        {
          stageName: approveStageName,
          actions: [approveAction],
        },
        {
          stageName: promoteStageName,
          actions: [promoteAction],
        },
      ],
    });

    /**
     * Event hook
     */

    // Create codebuild project for codepipeline manual approval failed
    const cleanupProject = new codebuild.Project(this, "CleanupProject", {
      projectName: `${serviceName}-cleanup-project-when-approve-failed`,
      source: codebuild.Source.codeCommit({
        repository: codeCommitRepository,
        branchOrRef: branch,
        cloneDepth: 1,
      }),
      buildSpec: codebuild.BuildSpec.fromAsset(
        path.join(__dirname, "../../scripts/build/buildspec.frontend.cleanup.yml")
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
      },
      environmentVariables: {
        SERVICE_NAME: { value: serviceName },
        ENVIRONMENT_NAME: { value: environmentName },
        BRANCH: { value: branch },
        BUCKET_NAME: { value: bucketName },
        DISTRIBUTION_ID: { value: distributionId },
      },
      badge: false,
      role: codebuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, "CleanupProjectLogGroup", {
            logGroupName: `${serviceName}/cleanup-project-when-approve-failed`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.THREE_DAYS,
          }),
        },
      },
    });

    // Define the EventBridge rule
    new events.Rule(this, "EventHookRule", {
      enabled: true,
      ruleName: `${serviceName}-pipeline-event-hook`,
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
      targets: [new events_targets.CodeBuildProject(cleanupProject)],
    });
  }
}
