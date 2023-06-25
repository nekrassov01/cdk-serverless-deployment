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

// Retrieves the files that have changed between last 2 commits
func getChangedFiles(ctx context.Context, cfg *aws.Config, repositoryName string, oldCommitId string, commitId string) ([]string, error) {
	// Create a CodeCommit client from the configuration
	client := codecommit.NewFromConfig(*cfg)

	// Request the differences between the two specified commits
	resp, err := client.GetDifferences(ctx, &codecommit.GetDifferencesInput{
		RepositoryName:        aws.String(repositoryName),
		BeforeCommitSpecifier: aws.String(oldCommitId),
		AfterCommitSpecifier:  aws.String(commitId),
	})
	if err != nil {
		return nil, fmt.Errorf("getting differences failed: %w", err)
	}

	// Extract file paths from the differences
	var paths []string
	for _, diff := range resp.Differences {
		paths = append(paths, *diff.AfterBlob.Path)
	}

	return paths, nil
}

// Starts a CodePipeline execution
func startPipeline(ctx context.Context, cfg *aws.Config, pipelineName string) (*codepipeline.StartPipelineExecutionOutput, error) {
	// Create a CodePipeline client from the configuration
	client := codepipeline.NewFromConfig(*cfg)

	// Start the execution of the specified pipeline
	resp, err := client.StartPipelineExecution(ctx, &codepipeline.StartPipelineExecutionInput{
		Name: aws.String(pipelineName),
	})
	if err != nil {
		return nil, fmt.Errorf("starting pipeline failed: %w", err)
	}
	return resp, nil
}

// Lambda function handler that triggers pipelines based on changes in CodeCommit repositories
func handleRequest(ctx context.Context, event events.CloudWatchEvent) {
	// Retrieve pipeline configuration from the environment variable
	pipelineMap := os.Getenv("PIPELINES")
	if pipelineMap == "" {
		log.Fatalf("Error environment variable PIPELINES not set")
	}

	// Parse the pipeline configuration
	var pipelines []PipelineInfo
	if err := json.Unmarshal([]byte(pipelineMap), &pipelines); err != nil {
		log.Fatalf("Error unmarshalling PIPELINES environment variable: %v", err)
	}

	// Parse the event detail from CodeCommit
	var detail CodeCommitDetail
	if err := json.Unmarshal(event.Detail, &detail); err != nil {
		log.Fatalf("Error unmarshalling event detail: %v", err)
	}

	// Load AWS SDK configuration
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatalf("Error loading SDK configuration: %v", err)
	}

	// Retrieve the paths of the files that have changed
	paths, err := getChangedFiles(ctx, &cfg, detail.RepositoryName, detail.OldCommitId, detail.CommitId)
	if err != nil {
		log.Fatalf("Error getting changed files: %v", err)
	}

	// Determine which pipelines should be triggered based on the file paths
	targetPipelines := make(map[string]struct{})
	prefix := strings.Split(os.Getenv("AWS_LAMBDA_FUNCTION_NAME"), "pipeline-handler")[0]
	for _, pipeline := range pipelines {
		pipelineName := prefix + pipeline.Name + "-pipeline"
		for _, path := range paths {
			if strings.HasPrefix(path, pipeline.Path) {
				targetPipelines[pipelineName] = struct{}{}
				break
			}
		}
	}

	// Start execution of the target pipelines
	for pipelineName := range targetPipelines {
		resp, err := startPipeline(ctx, &cfg, pipelineName)
		if err != nil {
			log.Fatalf("Error starting pipeline %s: %v\n", pipelineName, err)
		}
		log.Printf("Pipeline started complete successfully: %s, executionId: %s\n", pipelineName, *resp.PipelineExecutionId)
	}
}

// Entrypoint of the Lambda function
func main() {
	lambda.Start(handleRequest)
}
