/* eslint-disable no-console */
import { CodeCommitClient, GetDifferencesCommand, GetDifferencesCommandInput } from "@aws-sdk/client-codecommit";
import {
  CodePipelineClient,
  StartPipelineExecutionCommand,
  StartPipelineExecutionCommandInput,
} from "@aws-sdk/client-codepipeline";
import { EventBridgeEvent, Handler } from "aws-lambda";

type TDetailCodeCommitEvent = {
  event: string;
  repositoryName: string;
  repositoryId: string;
  referenceType: string;
  referenceName: string;
  referenceFullName: string;
  commitId: string;
  oldCommitId: string;
  baseCommitId: string;
  sourceCommitId: string;
  destinationCommitId: string;
  mergeOption: string;
  conflictDetailsLevel: string;
  conflictResolutionStrategy: string;
};

const codecommitClient = new CodeCommitClient({
  region: process.env.AWS_DEFAULT_REGION,
});

const codepipelineClient = new CodePipelineClient({
  region: process.env.AWS_DEFAULT_REGION,
});

const pipelineMap = process.env.PIPELINE_MAP ? JSON.parse(process.env.PIPELINE_MAP) : [];

export const handler: Handler = async (event: EventBridgeEvent<string, TDetailCodeCommitEvent>) => {
  try {
    const commitId = event.detail.commitId;
    const repository = event.detail.repositoryName;
    const lastCommitId = event.detail.oldCommitId;
    const paths = await getModifiedFilesSinceLastRun(repository, lastCommitId, commitId);

    console.log("paths:", paths);

    const pipelinePrefix = process.env.AWS_LAMBDA_FUNCTION_NAME?.split("pipeline-handler")[0];
    const pipelineNames: Set<string> = new Set();

    for (const path of paths) {
      for (const mapItem of pipelineMap) {
        if (path.startsWith(mapItem.path)) {
          pipelineNames.add(pipelinePrefix + mapItem.name + "-pipeline");
          break;
        }
      }
    }

    console.log("pipelineNames:", [...pipelineNames]);

    const result = await startCodepipelines([...pipelineNames]);
    console.log(result);
  } catch (e) {
    console.error(e);
  }
};

const startCodepipelines = async (codepipelineNames: string[]) => {
  if (codepipelineNames.length === 0) {
    return null;
  }

  try {
    const result = await Promise.all(
      codepipelineNames.map((codepipelineName) => {
        const params: StartPipelineExecutionCommandInput = {
          name: codepipelineName,
        };
        const command = new StartPipelineExecutionCommand(params);
        return codepipelineClient.send(command);
      })
    );

    return result;
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const getModifiedFilesSinceLastRun = async (
  repositoryName: string,
  beforeCommitSpecifier: string | undefined,
  afterCommitSpecifier: string
): Promise<string[]> => {
  try {
    const params: GetDifferencesCommandInput = {
      repositoryName: repositoryName,
      beforeCommitSpecifier: beforeCommitSpecifier,
      afterCommitSpecifier: afterCommitSpecifier,
    };
    const command = new GetDifferencesCommand(params);
    const diff = (await codecommitClient.send(command)).differences;

    const beforeBlobPaths: Set<string> = new Set();
    const afterBlobPaths: Set<string> = new Set();

    if (diff) {
      for (const d of diff) {
        if (d.beforeBlob?.path) {
          beforeBlobPaths.add(d.beforeBlob.path);
        }
        if (d.afterBlob?.path) {
          afterBlobPaths.add(d.afterBlob.path);
        }
      }
    }

    const allModifications: Set<string> = new Set([...beforeBlobPaths, ...afterBlobPaths]);

    return Array.from(allModifications).filter((f) => f !== null);
  } catch (e) {
    console.error(e);
    throw e;
  }
};
