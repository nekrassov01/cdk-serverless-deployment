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
	RepositoryName string `json:"repositoryName"`
	CommitID       string `json:"commitId"`
}

func handleRequest(ctx context.Context, event events.CloudWatchEvent) {
	pipelinePrefix := strings.Split(os.Getenv("AWS_LAMBDA_FUNCTION_NAME"), "pipeline-handler")[0]

	pipelinesJSON := os.Getenv("PIPELINES")
	if pipelinesJSON == "" {
		log.Fatalf("PIPELINES environment variable is not set")
	}

	var pipelines []PipelineInfo
	err := json.Unmarshal([]byte(pipelinesJSON), &pipelines)
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

	ccClient := codecommit.NewFromConfig(cfg)
	cpClient := codepipeline.NewFromConfig(cfg)

	for _, pipeline := range pipelines {
		changes, err := ccClient.GetDifferences(ctx, &codecommit.GetDifferencesInput{
			RepositoryName:       aws.String(detail.RepositoryName),
			AfterCommitSpecifier: aws.String(detail.CommitID),
			BeforePath:           aws.String(pipeline.Path),
			AfterPath:            aws.String(pipeline.Path),
		})
		if err != nil {
			log.Printf("Error getting differences: %v", err)
			continue
		}

		if len(changes.Differences) > 0 {
			_, err := cpClient.StartPipelineExecution(ctx, &codepipeline.StartPipelineExecutionInput{
				Name: aws.String(pipelinePrefix + pipeline.Name + "-pipeline"),
			})
			if err != nil {
				log.Printf("Error starting pipeline %s: %v", pipeline.Name, err)
			}
			log.Printf("Started pipeline: %s", pipeline.Name)
		}
	}
}

func main() {
	lambda.Start(handleRequest)
}
