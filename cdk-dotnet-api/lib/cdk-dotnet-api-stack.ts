import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';

import { LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';

export class CdkDotnetApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

// 👇 parameter of type String
    const apiName = this.node.tryGetContext('ApiName');

    // OpenApi Bucket
    const openApiBucket = new s3.Bucket(this, apiName+ 'OpenApi');

    // CodeCommit
    console.log('Creating repository.');
    const repository = new codecommit.Repository(this, apiName, {
      repositoryName: apiName
    });

    const sourceArtifact = new codepipeline.Artifact('SourceArtifact');
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit',
      repository: repository,
      output: sourceArtifact,
    });

    // Code Build
    console.log('Creating Build Action.');
    const projectName = apiName + 'Project';
    const project = new codebuild.PipelineProject(this, projectName, {
      projectName:projectName,
      environment: {
        buildImage: LinuxBuildImage.STANDARD_6_0
      }
    });
    const ssmPutParameterPolicy = new iam.PolicyStatement({
      actions: ['ssm:PutParameter'],
      resources: ['*'],
    });
    const s3PutObjectBucketsPolicy = new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [openApiBucket.bucketArn+'/*'],
    });

    project.role?.attachInlinePolicy(new iam.Policy(this, 'open-api', {
      policyName: apiName+'OpenApiPolicy',
      statements: [s3PutObjectBucketsPolicy, ssmPutParameterPolicy]
    }))

    const buildArtifact = new codepipeline.Artifact('BuildArtifact');
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project,
      input: sourceArtifact,
      outputs: [buildArtifact],
      environmentVariables: {
        BucketOpenAPI: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: openApiBucket.bucketName,
        },
        AWS_ACCOUNT_ID: {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: cdk.Stack.of(this).account,
        },
      }
    });

    // Code Deploy
    console.log('Creating deploy action.')
    const deployAction = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
      actionName: 'Deploy',
      stackName: apiName + 'Stack',
      adminPermissions: true,
      replaceOnFailure: true,
      extraInputs: [buildArtifact],
      templatePath: sourceArtifact.atPath('template.yml'),
      parameterOverrides: {
        ApiName: apiName,
        BucketName: buildArtifact.bucketName,
        ObjectKey: buildArtifact.objectKey
      }
    })

    // Pipeline
    console.log('Creating pipeline.');
    var pipelineName = apiName + 'Pipeline' ;
    const pipeline = new codepipeline.Pipeline(this, pipelineName,{
      pipelineName: pipelineName,
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction]
        },
        {
          stageName: 'Build',
          actions: [buildAction]
        },
        {
          stageName: 'Deploy',
          actions: [deployAction]
        }

      ]
    });
  }
}
