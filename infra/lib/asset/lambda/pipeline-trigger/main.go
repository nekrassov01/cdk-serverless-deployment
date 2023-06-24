package main

import (
	"context"
	"encoding/json"
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

type PipelineInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
}

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

// Retrieve files that have changed
func getChangedFiles(ctx context.Context, cfg *aws.Config, repositoryName string, oldCommitId string, commitId string) ([]string, error) {
	client := codecommit.NewFromConfig(*cfg)

	resp, err := client.GetDifferences(ctx, &codecommit.GetDifferencesInput{
		RepositoryName:        aws.String(repositoryName),
		BeforeCommitSpecifier: aws.String(oldCommitId),
		AfterCommitSpecifier:  aws.String(commitId),
	})
	if err != nil {
		log.Printf("Error getting differences: %v", err)
	}

	var paths []string
	for _, diff := range resp.Differences {
		paths = append(paths, *diff.AfterBlob.Path)
	}

	return paths, nil
}

func startPipeline(ctx context.Context, cfg *aws.Config, pipelineName string) {
	client := codepipeline.NewFromConfig(*cfg)

	resp, err := client.StartPipelineExecution(ctx, &codepipeline.StartPipelineExecutionInput{
		Name: aws.String(pipelineName),
	})
	if err != nil {
		log.Printf("Error starting pipeline: %v", err)
	}
	log.Printf("Success started pipeline: %s, executionId: %s\n", pipelineName, *resp.PipelineExecutionId)
}

func getUnique(elements []string) []string {
	seen := make(map[string]struct{})
	var result []string

	log.Printf("Info target pipelines before duplicate removal: %v", elements)

	for _, element := range elements {
		if _, ok := seen[element]; !ok {
			seen[element] = struct{}{}
			result = append(result, element)
		}
	}

	log.Printf("Info target pipelines after duplicate removal: %v", result)

	return result
}

func handleRequest(ctx context.Context, event events.CloudWatchEvent) {
	pipelineMap := os.Getenv("PIPELINES")
	if pipelineMap == "" {
		log.Fatalf("Error environment variable PIPELINES not set")
	}

	var pipelines []PipelineInfo
	err := json.Unmarshal([]byte(pipelineMap), &pipelines)
	if err != nil {
		log.Fatalf("Error unmarshalling PIPELINES environment variable: %v", err)
	}

	var detail CodeCommitDetail
	err = json.Unmarshal(event.Detail, &detail)
	if err != nil {
		log.Fatalf("Error unmarshalling event detail: %v", err)
	}

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Error loading SDK configuration: %v", err)
	}

	paths, err := getChangedFiles(context.TODO(), &cfg, detail.RepositoryName, detail.OldCommitId, detail.CommitId)
	if err != nil {
		log.Fatalf("Error getting changed files: %v", err)
	}

	var targetPipelines []string
	prefix := strings.Split(os.Getenv("AWS_LAMBDA_FUNCTION_NAME"), "pipeline-handler")[0]
	for _, path := range paths {
		for _, pipeline := range pipelines {
			pipelineName := prefix + pipeline.Name + "-pipeline"
			if strings.HasPrefix(path, pipeline.Path) {
				targetPipelines = append(targetPipelines, pipelineName)
			}
		}
	}

	for _, pipeline := range getUnique(targetPipelines) {
		startPipeline(context.TODO(), &cfg, pipeline)
	}
}

func main() {
	lambda.Start(handleRequest)
}
