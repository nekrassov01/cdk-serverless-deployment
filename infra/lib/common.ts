import { CodeCommitClient, ListBranchesCommand, ListBranchesCommandOutput } from "@aws-sdk/client-codecommit";
import { DescribeRepositoriesCommand, DescribeRepositoriesCommandOutput, ECRClient } from "@aws-sdk/client-ecr";
import { GetCallerIdentityCommand, GetCallerIdentityCommandOutput, STSClient } from "@aws-sdk/client-sts";
import {
  App,
  Duration,
  Lazy,
  RemovalPolicy,
  Size,
  Tags,
  aws_codepipeline_actions as actions,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sqs as sqs,
  aws_ssm as ssm,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { existsSync, readFileSync, writeFileSync } from "fs";

const app = new App();

// Environment name definition
const envs = {
  Development: "dev",
  Staging: "stg",
  Production: "prod",
} as const;

// Environment name type
type EnvironmentName = (typeof envs)[keyof typeof envs];

// Valid Environment name list
const validEnvNames = Object.values(envs);

// Interface for handling parameters
interface ICommonParameter {
  [key: string]: any;
}

/**
 * Self-created class to be called from all stacks
 */

export class Common {
  public readonly service = app.node.tryGetContext("service");
  public readonly owner = app.node.tryGetContext("owner");
  public readonly addresses = app.node.tryGetContext("addresses");
  public readonly environment = app.node.tryGetContext("environment");
  public readonly repository = app.node.tryGetContext("repository");
  public readonly branch = app.node.tryGetContext("branch");
  public readonly defaultConfig = app.node.tryGetContext("defaultConfig");
  public readonly environments = app.node.tryGetContext("environments");
  public readonly pipelines = app.node.tryGetContext("pipelines");
  public readonly containers = app.node.tryGetContext("containers");

  // Validate environment settings and return bool
  private isValidEnvironment(): boolean {
    try {
      const targetEnv = this.environment;
      const envNames = this.environments.map((obj: ICommonParameter) => obj.name);
      const envNameUniqueLength = Array.from(new Set(envNames)).length;

      // Is the environment name defined in `environment` valid
      if (!validEnvNames.includes(targetEnv)) {
        return false;
      }

      // Is each environment name defined in `environments` valid
      envNames.forEach((value: EnvironmentName): boolean | void => {
        if (!validEnvNames.includes(value)) {
          return false;
        }
      });

      // Are there any duplicate environment names in `environments`
      if (envNames.length !== envNameUniqueLength) {
        return false;
      }

      // Are there any duplicate environment accounts in `environments`
      if (
        envNameUniqueLength !==
        Array.from(new Set(this.environments.map((obj: ICommonParameter) => obj.account))).length
      ) {
        return false;
      }

      // Whether the environment name defined in `environment` is in `environments`
      if (
        envNames.filter((value: EnvironmentName) => {
          return value === targetEnv;
        }).length !== 1
      ) {
        return false;
      }

      return true;
    } catch (e) {
      throw e;
    }
  }

  // Verify environment settings
  public verifyEnvironment(): void {
    if (!this.isValidEnvironment()) {
      throw new Error(this.getConsoleMessage("Environment setting in 'cdk.json' not valid."));
    }
  }

  // Get environment setting
  public getEnvironment(environmentName?: EnvironmentName): ICommonParameter {
    try {
      const envName = environmentName ? environmentName : this.environment;
      return this.environments.find((obj: ICommonParameter) => {
        return obj.name === envName;
      });
    } catch (e) {
      throw e;
    }
  }

  // Get caller identity for verification
  private async getCallerIdentity(): Promise<GetCallerIdentityCommandOutput> {
    try {
      const client = new STSClient({ region: this.getEnvironment().region });
      return await client.send(new GetCallerIdentityCommand({}));
    } catch (e) {
      throw e;
    }
  }

  // Verify if the caller account matches the account specified as the target of the CDK
  public verifyCallerAccount(): void {
    try {
      const targetAccount = this.getEnvironment().account;
      this.getCallerIdentity().then((obj) => {
        if (obj.Account !== targetAccount) {
          throw new Error(
            this.getConsoleMessage(
              `The caller account '${obj.Account}' does not match the account '${targetAccount}' specified as the target of the CDK.`
            )
          );
        }
      });
    } catch (e) {
      throw e;
    }
  }

  // Get CodeCommit repository remote branche list
  private async getCodeCommitRemoteBranches(): Promise<ListBranchesCommandOutput> {
    try {
      const client = new CodeCommitClient({ region: this.getEnvironment().region });
      return await client.send(new ListBranchesCommand({ repositoryName: this.repository }));
    } catch (e) {
      throw e;
    }
  }

  // Verify the target branch exists in remote branches of the CodeCommit repository
  public verifyBranch(): void {
    try {
      this.getCodeCommitRemoteBranches().then((obj) => {
        if (!obj.branches?.includes(this.branch)) {
          throw new Error(
            this.getConsoleMessage(
              `Target branch does not exist in remote branches of the repository '${this.repository}'`
            )
          );
        }
      });
    } catch (e) {
      throw e;
    }
  }

  // Get container setting
  public getContainer(imageName: string): ICommonParameter {
    try {
      const ret = this.containers.find((obj: ICommonParameter) => {
        return obj.name === imageName;
      });
      if (!ret) {
        throw new Error(this.getConsoleMessage(`Container image '${imageName}' not found in 'cdk.json'`));
      }
      return ret;
    } catch (e) {
      throw e;
    }
  }

  // Get ECR repository
  public getContainerRepository(scope: Construct, imageName: string): ecr.IRepository {
    const config = this.getContainer(imageName);
    const repoEnv = this.getEnvironment(config.environment);
    return ecr.Repository.fromRepositoryArn(
      scope,
      "ContainerRepository",
      `arn:aws:ecr:${repoEnv.region}:${repoEnv.account}:repository/${config.repository}`
    );
  }

  // Validate container setting and return bool
  private isValidContainer(containerConfig: ICommonParameter): boolean {
    try {
      // Is the environment name valid
      if (!validEnvNames.includes(containerConfig.environment)) {
        return false;
      }

      // Is other parameters present
      if (
        !Object.keys(containerConfig.repository).length ||
        !Object.keys(containerConfig.imagePath).length ||
        !Object.keys(containerConfig.version).length ||
        !Object.keys(containerConfig.tag).length
      ) {
        return false;
      }

      return true;
    } catch (e) {
      throw e;
    }
  }

  // Get remote ECR repositories
  private async getRemoteContainerRepositories(env: ICommonParameter): Promise<DescribeRepositoriesCommandOutput> {
    try {
      const client = new ECRClient({ region: env.region });
      return await client.send(new DescribeRepositoriesCommand({ registryId: env.Account }));
    } catch (e) {
      throw e;
    }
  }

  // Verify remote ECR repository exists
  private verifyContainerRepository(env: ICommonParameter, containerConfig: ICommonParameter) {
    try {
      this.getRemoteContainerRepositories(env).then((obj) => {
        if (
          obj.repositories?.find((repo) => {
            return repo.repositoryName === containerConfig.repository;
          }) === undefined
        ) {
          throw new Error(this.getConsoleMessage(`Container repository '${containerConfig.repository}' not found.`));
        }
      });
    } catch (e) {
      throw e;
    }
  }

  // Verify container setting and ECR repository exists
  public verifyContainer(): void {
    try {
      const containerNames = this.containers.map((obj: ICommonParameter) => obj.name);
      const containerNameUniqueLength = Array.from(new Set(containerNames)).length;

      containerNames.map((imageName: string) => {
        const config = this.getContainer(imageName);
        const repoEnv = this.getEnvironment(config.environment);
        const templateFile = `${config.imagePath}/template`;

        if (!this.isValidContainer(config)) {
          throw new Error(this.getConsoleMessage(`Container settings '${imageName}' in 'cdk.json' not valid.`));
        }

        // Does the template file exist
        if (!existsSync(templateFile)) {
          throw new Error(this.getConsoleMessage(`Template file not found. Please check '${templateFile}' exists.`));
        }

        // Check if the ECR repository exists
        this.verifyContainerRepository(repoEnv, config);
      });

      // Are there any duplicate container names in `params.containers`
      if (containerNames.length !== containerNameUniqueLength) {
        throw new Error(this.getConsoleMessage(`Container name duplicated in 'cdk.json'`));
      }
    } catch (e) {
      throw e;
    }
  }

  // Create Dockerfile with template and 'cdk.json' parameters
  public createDockerfile(imageName: string): void {
    try {
      const config = this.getContainer(imageName);
      const templateFile = `${config.imagePath}/template`;
      let out = readFileSync(templateFile).toString();
      config.version.forEach((element: string, index: number) => {
        out = out.replaceAll(`\$\{VERSION_${index}\}`, element);
      });
      writeFileSync(`${config.imagePath}/Dockerfile`, out);
    } catch (e) {
      throw e;
    }
  }

  // Referenced on <https://sdhuang32.github.io/ssm-StringParameter-valueFromLookup-use-cases-and-internal-synth-flow/>
  public static lazifyString(value: string): string {
    return Lazy.string({ produce: () => value });
  }

  // Converting dummy strings: Workaround <https://github.com/aws/aws-cdk/issues/8699>
  public static sanitizeString(value: string): string {
    return value.includes("dummy-value") ? "dummy" : value;
  }

  // Converting dummy ARNs: Workaround <Same as above>
  public static sanitizeArn(value: string): string {
    return value.includes("dummy-value") ? "arn:aws:service:us-east-1:123456789012:entity/dummy-value" : value;
  }

  // Converting Pascal case to Kebab case
  public static convertPascalToKebabCase(value: string): string {
    return value.replace(/\.?([A-Z]+)/g, (x, y) => "-" + y.toLowerCase()).replace(/^-/, "");
  }

  // Converting Kebab case to Pascal case
  public static convertKebabToPascalCase(value: string): string {
    return value
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }

  // Returns environment as boolean: Production
  public isProduction(): boolean {
    return this.environment === envs.Production ? true : false;
  }

  // Returns environment as boolean: Staging
  public isStaging(): boolean {
    return this.environment === envs.Staging ? true : false;
  }

  // Returns environment as boolean: Development
  public isDevelopment(): boolean {
    return this.environment === envs.Development ? true : false;
  }

  //  Returns environment as boolean: Production or Staging
  public isProductionOrStaging(): boolean {
    return this.environment === envs.Production || this.environment === envs.Staging ? true : false;
  }

  // Add prefix to resource ID
  public getId(value: string): string {
    return (
      Common.convertKebabToPascalCase(this.service) +
      Common.convertKebabToPascalCase(this.environment) +
      Common.convertKebabToPascalCase(this.branch) +
      value
    );
  }

  // Add prefix to resource name
  public getResourceName(value: string): string {
    return this.isProductionOrStaging()
      ? `${this.service}-${this.environment}-${value}`
      : `${this.service}-${this.environment}-${this.branch}-${value}`;
  }

  // Add prefix to hierarchical name prefix
  public getResourceNamePath(value: string): string {
    return `/${this.service}/${this.environment}/${this.branch}/${value}`;
  }

  // Add prefix to console message
  public getConsoleMessage(value: string): string {
    return `[${this.service.toUpperCase()}] ${value}`;
  }

  // Get hosted zone domain
  public getHostedZone(): string {
    return this.getEnvironment().hostedZone;
  }

  // Create a domain name by concatenating strings
  public getDomain(): string {
    const environment = Common.convertPascalToKebabCase(this.environment);
    return this.isProductionOrStaging()
      ? `${environment}.${this.getEnvironment().hostedZone}`
      : `${environment}-${Common.convertPascalToKebabCase(this.branch)}.${this.getEnvironment().hostedZone}`;
  }

  // Default removal policy
  public getRemovalPolicy(): RemovalPolicy {
    return this.isProductionOrStaging() ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
  }

  // Default log retention days
  public getLogsRetentionDays(): logs.RetentionDays {
    return this.isProductionOrStaging() ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_DAY;
  }

  // Default KMS key pending days
  public getKmsKeyPendingDays(): Duration {
    return this.isProductionOrStaging() ? Duration.days(30) : Duration.days(7);
  }

  // Default VPC settings
  public getVpcParameter(): ICommonParameter {
    return this.isProductionOrStaging()
      ? {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
          natGateways: 2,
          maxAzs: 2,
          subnetCidrMask: 24,
        }
      : {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
          natGateways: 1,
          maxAzs: 2,
          subnetCidrMask: 24,
        };
  }

  // Default pipeline trigger
  public getPipelineTrigger(): actions.CodeCommitTrigger {
    return this.isProductionOrStaging() ? actions.CodeCommitTrigger.NONE : actions.CodeCommitTrigger.EVENTS;
  }

  // Get string parameter from SSM parameter store
  public getSsmParameter(scope: Construct, name: string): string {
    return ssm.StringParameter.valueForTypedStringParameterV2(
      scope,
      this.getResourceNamePath(name),
      ssm.ParameterValueType.STRING
    );
  }

  // Default S3 settings
  public getS3Parameter(): ICommonParameter {
    return this.isProductionOrStaging()
      ? {
          removalPolicy: RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
          durationDays: Duration.days(90),
        }
      : {
          removalPolicy: RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
          durationDays: Duration.days(30),
        };
  }

  // Default RDS settings (for mysql)
  public getRdsParameter(): ICommonParameter {
    return this.isProductionOrStaging()
      ? {
          deletionProtection: true,
          backup: {
            retentionDays: Duration.days(7),
          },
          monitoringInterval: Duration.minutes(1),
          scaling: {
            minCapacity: 2,
            maxCapacity: 64,
          },
          performanceInsightRetention: Duration.days(7),
          secretRetentionDays: Duration.days(7),
        }
      : {
          deletionProtection: false,
          backup: {
            retentionDays: Duration.days(1),
          },
          monitoringInterval: Duration.minutes(1),
          scaling: {
            minCapacity: 0.5,
            maxCapacity: 2,
          },
          performanceInsightRetention: Duration.days(1),
          secretRetentionDays: Duration.days(7),
        };
  }

  // Default ECS settings
  public getEcsParameter(): ICommonParameter {
    return this.isProductionOrStaging()
      ? {
          taskDefinition: {
            cpu: 4096,
            memoryLimitMiB: 8192,
            command: ["start", "--optimized"],
          },
          service: {
            nodeCount: 4,
            healthCheckGracePeriod: Duration.minutes(5),
            circuitBreaker: { rollback: true },
            scaling: {
              base: {
                minCapacity: 2,
                maxCapacity: 8,
                cpuUtilization: 70,
                scaleOutCoolDown: Duration.seconds(300),
                scaleInCoolDown: Duration.seconds(300),
              },
              schedule: {
                beforeOpening: {
                  minCapacity: 4,
                  maxCapacity: 24,
                  cron: {
                    minute: "30",
                    hour: "23",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                afterOpening: {
                  minCapacity: 2,
                  maxCapacity: 8,
                  cron: {
                    minute: "30",
                    hour: "1",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                beforeClosing: {
                  minCapacity: 4,
                  maxCapacity: 24,
                  cron: {
                    minute: "0",
                    hour: "8",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                afterClosing: {
                  minCapacity: 2,
                  maxCapacity: 4,
                  cron: {
                    minute: "0",
                    hour: "10",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
              },
            },
          },
          alb: {
            healthyThresholdCount: 3,
            interval: Duration.seconds(60),
            timeout: Duration.seconds(30),
            slowStart: Duration.seconds(60),
            stickinessCookieDuration: Duration.days(1),
          },
          bastion: {
            instanceType: "m5.large",
          },
        }
      : {
          taskDefinition: {
            cpu: 1024,
            memoryLimitMiB: 2048,
            command: ["--verbose", "start"],
          },
          service: {
            nodeCount: 1,
            healthCheckGracePeriod: Duration.minutes(5),
            circuitBreaker: undefined,
            scaling: {
              base: {
                minCapacity: 1,
                maxCapacity: 2,
                cpuUtilization: 90,
                scaleOutCoolDown: Duration.seconds(300),
                scaleInCoolDown: Duration.seconds(300),
              },
              schedule: {
                beforeOpening: {
                  minCapacity: 2,
                  maxCapacity: 4,
                  cron: {
                    minute: "30",
                    hour: "23",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                afterOpening: {
                  minCapacity: 1,
                  maxCapacity: 2,
                  cron: {
                    minute: "30",
                    hour: "1",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                beforeClosing: {
                  minCapacity: 2,
                  maxCapacity: 4,
                  cron: {
                    minute: "0",
                    hour: "8",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
                afterClosing: {
                  minCapacity: 1,
                  maxCapacity: 2,
                  cron: {
                    minute: "0",
                    hour: "10",
                    weekDay: "MON-FRI",
                    month: "*",
                    year: "*",
                  },
                },
              },
            },
          },
          alb: {
            healthyThresholdCount: 3,
            interval: Duration.seconds(60),
            timeout: Duration.seconds(30),
            slowStart: Duration.seconds(60),
            stickinessCookieDuration: Duration.days(1),
          },
          bastion: {
            instanceType: "t3.micro",
          },
        };
  }

  // Add owner tag
  public addOwnerTag(scope: Construct): void {
    Tags.of(scope).add("Owner", this.owner);
  }

  // Add name tag
  public addNameTag(scope: Construct, name: string): void {
    Tags.of(scope).add("Name", name);
  }

  // Create a basic configuration bucket
  public createBucket(
    scope: Construct,
    id: string,
    {
      bucketName,
      lifecycle = false,
      parameterStore = false,
      objectOwnership = false,
    }: {
      bucketName: string;
      lifecycle: boolean;
      parameterStore: boolean;
      objectOwnership: Boolean;
    }
  ): s3.Bucket {
    const s3RemovalPolicy = this.getS3Parameter();

    // Default S3 bucket settings
    const bucket = new s3.Bucket(scope, id, {
      bucketName: this.getResourceName(bucketName),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: s3RemovalPolicy.removalPolicy,
      autoDeleteObjects: s3RemovalPolicy.autoDeleteObjects,
      versioned: false,
      objectOwnership: objectOwnership ? s3.ObjectOwnership.BUCKET_OWNER_PREFERRED : undefined,
    });

    // File rotation configuration
    if (lifecycle) {
      bucket.addLifecycleRule({
        id: this.getResourceName(bucketName),
        enabled: true,
        abortIncompleteMultipartUploadAfter: s3RemovalPolicy.durationDays,
        expiration: s3RemovalPolicy.durationDays,
      });
    }

    // Put bucket name to SSM parameter store
    if (parameterStore) {
      new ssm.StringParameter(scope, `${id}Parameter`, {
        parameterName: this.getResourceNamePath(`s3/${bucketName}`),
        stringValue: bucket.bucketName,
      });
    }

    return bucket;
  }

  public createLambdaFunction(
    scope: Construct,
    id: string,
    {
      functionName,
      description,
      code,
      handler,
      runtime,
      layers,
      role,
      timeout = Duration.minutes(5),
      memorySize = 128,
      ephemeralStorageSize = Size.mebibytes(512),
      environment,
      parameterStore = false,
    }: {
      functionName: string;
      description?: string;
      runtime: lambda.Runtime;
      handler: string;
      code: lambda.Code;
      layers?: lambda.ILayerVersion[] | undefined;
      role?: iam.Role;
      timeout?: Duration;
      memorySize?: number;
      ephemeralStorageSize?: Size;
      environment?: { [key: string]: string };
      parameterStore: boolean;
    }
  ): lambda.Alias {
    const funcName = Common.convertPascalToKebabCase(functionName);
    const env = this.getEnvironment();

    // Create role if undefined
    if (!role) {
      role = new iam.Role(scope, `${id}Role`, {
        roleName: this.getResourceName(`${funcName}-role`),
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        inlinePolicies: {
          [`${id}RoleAdditionalPolicy`]: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                resources: [`arn:aws:logs:${env.region}:${env.account}:*`],
              }),
            ],
          }),
        },
      });
    }

    // Create queue
    const deadLetterQueue = new sqs.Queue(scope, `${id}Queue`, {
      queueName: this.getResourceName(`${funcName}-queue`),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: this.getRemovalPolicy(),
      retentionPeriod: Duration.days(7),
    });

    // Create function
    const func = new lambda.Function(scope, id, {
      functionName: this.getResourceName(funcName),
      description: description,
      code: code,
      handler: handler,
      layers: layers,
      architecture: lambda.Architecture.X86_64,
      runtime: runtime,
      memorySize: memorySize,
      ephemeralStorageSize: ephemeralStorageSize,
      timeout: timeout,
      role: role,
      logRetention: this.getLogsRetentionDays(),
      environment: environment,
      currentVersionOptions: {
        removalPolicy: RemovalPolicy.RETAIN,
      },
      deadLetterQueueEnabled: true,
      deadLetterQueue: deadLetterQueue,
      reservedConcurrentExecutions: 1,
      retryAttempts: 2,
    });

    // Update function alias
    const alias = new lambda.Alias(scope, `${id}Alias"`, {
      aliasName: this.defaultConfig.lambda.alias,
      version: func.currentVersion,
    });

    // Put bucket name to SSM parameter store
    if (parameterStore) {
      new ssm.StringParameter(scope, `${id}Parameter`, {
        parameterName: this.getResourceNamePath(`function/${funcName}`),
        stringValue: alias.functionArn,
      });
    }

    return alias;
  }
}

// Accident prevention
const common = new Common();
common.verifyEnvironment();
common.verifyCallerAccount();
common.verifyBranch();
common.verifyContainer();
