package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/codecommit"
	"github.com/aws/aws-sdk-go-v2/service/codepipeline"
)

// Information about a pipeline such as its name and target path
type PipelineInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

// Information about the event detail in CodeCommit
type CodeCommitDetail struct {
	Event                      string `json:"event"`
	RepositoryName             string `json:"repositoryName"`
	RepositoryId               string `json:"repositoryId"`
	ReferenceType              string `json:"referenceType"`
	ReferenceName              string `json:"referenceName"`
	ReferenceFullName          string `json:"referenceFullName"`
	CommitId                   string `json:"commitId"`
	OldCommitId                string `json:"oldCommitId"`
	BaseCommitId               string `json:"baseCommitId"`
	SourceCommitId             string `json:"sourceCommitId"`
	DestinationCommitId        string `json:"destinationCommitId"`
	MergeOption                string `json:"mergeOption"`
	ConflictDetailsLevel       string `json:"conflictDetailsLevel"`
	ConflictResolutionStrategy string `json:"conflictResolutionStrategy"`
}

// Global AWS SDK configuration
var cfg aws.Config

// Initializes the AWS SDK configuration
func init() {
	var err error
	cfg, err = config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("cannot load aws sdk config: %v", err)
	}
}

// Retrieves the files that have changed between last 2 commits
func getChangedFiles(ctx context.Context, repositoryName string, oldCommitId string, commitId string) ([]string, error) {
	var (
		paths     []string
		nextToken *string
	)

	client := codecommit.NewFromConfig(cfg)

	for {
		resp, err := client.GetDifferences(ctx, &codecommit.GetDifferencesInput{
			RepositoryName:        aws.String(repositoryName),
			BeforeCommitSpecifier: aws.String(oldCommitId),
			AfterCommitSpecifier:  aws.String(commitId),
			NextToken:             nextToken,
		})
		if err != nil {
			return nil, fmt.Errorf("cannot get file diff: %w", err)
		}

		for _, diff := range resp.Differences {
			if diff.AfterBlob != nil && diff.AfterBlob.Path != nil {
				paths = append(paths, *diff.AfterBlob.Path)
			}
		}

		nextToken = resp.NextToken
		if nextToken == nil {
			break
		}
	}

	return paths, nil
}

// Determines which pipelines should be triggered based on the changed paths
func getPipelines(paths []string, pipelines []PipelineInfo) map[string]struct{} {
	targets := make(map[string]struct{})
	prefix := strings.Split(os.Getenv("AWS_LAMBDA_FUNCTION_NAME"), "pipeline-handler")[0]

	pathMap := make(map[string]struct{})
	for _, path := range paths {
		pathMap[path] = struct{}{}
	}

	for _, pipeline := range pipelines {
		pipelineName := prefix + pipeline.Name + "-pipeline"
		for path := range pathMap {
			if strings.HasPrefix(path, pipeline.Path) {
				targets[pipelineName] = struct{}{}
				break
			}
		}
	}

	return targets
}

// Starts a CodePipeline execution
func startPipeline(ctx context.Context, pipelineName string) error {
	client := codepipeline.NewFromConfig(cfg)

	resp, err := client.StartPipelineExecution(ctx, &codepipeline.StartPipelineExecutionInput{
		Name: aws.String(pipelineName),
	})
	if err != nil {
		return fmt.Errorf("cannot start pipeline \"%s\": %w", pipelineName, err)
	}
	if resp.PipelineExecutionId == nil {
		return fmt.Errorf("cannot get executionId \"%s\"", pipelineName)
	}

	log.Printf("pipeline started: %s, executionId: %s\n", pipelineName, *resp.PipelineExecutionId)
	return nil
}

// Lambda function handler that triggers pipelines based on changes in CodeCommit repositories
func handleRequest(ctx context.Context, event events.CloudWatchEvent) error {
	pipelineConfig := os.Getenv("PIPELINES")
	if pipelineConfig == "" {
		return fmt.Errorf("PIPELINES environment variable is missing")
	}

	var pipelines []PipelineInfo
	if err := json.Unmarshal([]byte(pipelineConfig), &pipelines); err != nil {
		return fmt.Errorf("cannot unmarshal PIPELINES environment variable: %w", err)
	}

	var detail CodeCommitDetail
	if err := json.Unmarshal(event.Detail, &detail); err != nil {
		return fmt.Errorf("cannot unmarshal event detail: %w", err)
	}

	paths, err := getChangedFiles(ctx, detail.RepositoryName, detail.OldCommitId, detail.CommitId)
	if err != nil {
		return err
	}

	targetPipelines := getPipelines(paths, pipelines)
	for pipelineName := range targetPipelines {
		if err := startPipeline(ctx, pipelineName); err != nil {
			return err
		}
	}

	log.Printf("all pipelines started successfully")
	return nil
}

// Entrypoint of the Lambda function
func main() {
	lambda.Start(handleRequest)
}
