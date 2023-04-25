
const path = require('path')
const fs = require('fs')
const { Duration } = require('aws-cdk-lib')
const { Construct } = require('constructs')
// const ApiGateway = require('aws-cdk-lib/aws-apigateway')
const Lambda = require('aws-cdk-lib/aws-lambda')
const NodeJs = require('aws-cdk-lib/aws-lambda-nodejs')
const { Effect, PolicyStatement } = require('aws-cdk-lib/aws-iam')
const SNS = require('aws-cdk-lib/aws-sns')
const SNSSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions')
const SQS = require('aws-cdk-lib/aws-sqs')
const { SqsEventSource } = require('aws-cdk-lib/aws-lambda-event-sources')
// const Events = require('aws-cdk-lib/aws-events')
// const Targets = require('aws-cdk-lib/aws-events-targets')
const EC2 = require('aws-cdk-lib/aws-ec2')
const SSM = require('aws-cdk-lib/aws-ssm')
const SES = require('aws-cdk-lib/aws-ses')
// const { HTTPMethod } = require('http-method-enum')
const SecretsManager = require('aws-cdk-lib/aws-secretsmanager')

const DbPort = '3306'
const DbName = 'conorg'
const DbEndpoint = 'conorgdb-2016.czsl7m2plfxv.us-east-1.rds.amazonaws.com'
const LambdaRuntime = Lambda.Runtime.NODEJS_18_X

class ApiV2Service extends Construct {
  constructor (scope, id) {
    super(scope, id)

    const accountId = process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT
    const region = process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION

    const VpcId = SSM.StringParameter.valueFromLookup(this, 'badgevent-vpc-id')
    // const RdsId = SSM.StringParameter.valueFromLookup(this, 'badgevent-rds-id')
    const lambdaSecurityGroupId = SSM.StringParameter.valueFromLookup(this, 'badgevent-lambda-security-group-id')
    let eventbriteSecretArn = SSM.StringParameter.valueFromLookup(this, 'badgevent-eventbrite-api-secret')
    // workaround for CDK issue https://sdhuang32.github.io/ssm-StringParameter-valueFromLookup-use-cases-and-internal-synth-flow/
    if (eventbriteSecretArn.includes('dummy-value')) {
      eventbriteSecretArn = 'arn:aws:service:us-east-1:123456789012:entity/dummy-value'
    }
    const eventbriteConfigStringParameter = SSM.StringParameter.fromStringParameterAttributes(this, 'EventbriteConfig', { parameterName: 'badgevent-eventbrite-config' })

    // Import Existing Resources
    const Vpc = EC2.Vpc.fromLookup(this, 'Vpc', {
      vpcId: VpcId
    })
    const LambdaSecurityGroup = EC2.SecurityGroup.fromSecurityGroupId(this, 'LambdaSecurityGroup', lambdaSecurityGroupId)
    const eventbriteApiSecret = SecretsManager.Secret.fromSecretAttributes(this, 'eventbrite-api', { secretArn: eventbriteSecretArn })

    const sesConfigurationSetName = SSM.StringParameter.valueFromLookup(this, 'badgevent-ses-configuration-set-name')
    const sesEmailIdentityName = SSM.StringParameter.valueFromLookup(this, 'badgevent-ses-email-identity-name')

    const sesEventBriteNewRoleTemplateName = 'ses-eventbrite-new-role';
    (() => new SES.CfnTemplate(this, 'ses-eventbrite-new-role-template', {
      template: {
        templateName: sesEventBriteNewRoleTemplateName,
        subjectPart: 'Eventbrite Order Processed',
        htmlPart: fs.readFileSync('assets/email/eventbrite-new-role.html', 'utf8').toString('utf-8'),
        textPart: fs.readFileSync('assets/email/eventbrite-new-role.txt', 'utf8').toString('utf-8')
      }
    }))()

    // const api = new ApiGateway.RestApi(this, 'badgevent-api-v2', {
    //   restApiName: 'Badgevent API V2',
    //   description: 'Backend services for Badgevent applications.'
    // })

    // API
    // const apiV2 = api.root.addResource('api').addResource('v2')

    // Eventbrite Order Topic, S3 Notifications of new Eventbrite Order JSON in Bucket
    const eventbriteOrderTopic = new SNS.Topic(this, 'EventbriteOrderTopic', {
      topicName: 'eventbrite-order-topic'
    })

    // Eventbrite Order Queue
    const eventbriteOrderQueue = new SQS.Queue(this, 'EventbriteOrderQueue', {
      queueName: 'eventbrite-order-queue',
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(7)
    })
    // Subscribe the Eventbrite Order Queue to the Eventbrite Order SNS Topic
    eventbriteOrderTopic.addSubscription(new SNSSubscriptions.SqsSubscription(eventbriteOrderQueue, { rawMessageDelivery: true }))

    // Eventbrite Webhook Registration
    // const eventbriteWebhookRegistrationLambda = new NodeJs.NodejsFunction(this, 'EventbriteWebhookRegistration', {
    //   runtime: LambdaRuntime,
    //   entry: path.join(__dirname, '/../resources/eventbrite-webhook-registration.js'),
    //   architecture: Lambda.Architecture.X86_64,
    //   description: 'Registers the Eventbrite webhook with the Eventbrite API.',
    //   handler: 'handler',
    //   vpc: Vpc,
    //   vpcSubnets: [PrivateSubnet1, PrivateSubnet2],
    //   securityGroups: [LambdaSecurityGroup],
    //   environment: {
    //     DB_HOST: DbEndpoint,
    //     DB_PORT: DbPort,
    //     DB_NAME: DbName
    //   }
    // });

    // (() => apiV2.addResource('eventbrite-webhook-registration'))()
    // const eventRule = new Events.Rule(this, 'EventbriteWebhookRegistrationEventRule', {
    //   schedule: Events.Schedule.cron({ rate: '1 day' })
    // })
    // eventRule.addTarget(new Targets.LambdaFunction(eventbriteWebhookRegistrationLambda))

    // Eventbrite Webhook Processor
    // const bucket = new S3.Bucket(this, 'EventbriteOrders', {
    //   blockPublicAccess: S3.BlockPublicAccess.BLOCK_ALL,
    //   encryption: S3.BucketEncryption.S3_MANAGED,
    //   enforceSSL: true,
    //   versioned: true,
    //   removalPolicy: RemovalPolicy.RETAIN
    // })

    // const eventbriteWebhookLambda = new NodeJs.NodejsFunction(this, 'EventbriteWebhook', {
    //   runtime: LambdaRuntime,
    //   entry: path.join(__dirname, '/../resources/eventbrite-webhook.js'),
    //   architecture: Lambda.Architecture.X86_64,
    //   description: 'Registers the Eventbrite webhook with the Eventbrite API.',
    //   handler: 'handler',
    //   vpc: Vpc,
    //   vpcSubnets: [PrivateSubnet1, PrivateSubnet2],
    //   securityGroups: [LambdaSecurityGroup],
    //   environment: {
    //     DB_HOST: DbEndpoint,
    //     DB_PORT: DbPort,
    //     DB_NAME: DbName,
    //     BUCKET: bucket.bucketName
    //   }
    // })
    // bucket.grantReadWrite(eventbriteWebhookLambda)

    const eventbriteOrderProcessorLambda = new NodeJs.NodejsFunction(this, 'EventbriteOrderProcessor', {
      runtime: LambdaRuntime,
      entry: path.join(__dirname, '/../../assets/lambda/workers/eventbrite-order-processor.js'),
      architecture: Lambda.Architecture.X86_64,
      description: 'Creates or updates Badgevent roles based on Eventbrite orders.',
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(1),
      vpc: Vpc,
      vpcSubnets: [Vpc.privateSubnets[0], Vpc.privateSubnets[1]],
      securityGroups: [LambdaSecurityGroup],
      environment: {
        DB_HOST: DbEndpoint,
        DB_PORT: DbPort,
        DB_NAME: DbName,
        SES_CONFIGSET: sesConfigurationSetName,
        SES_TEMPLATE: sesEventBriteNewRoleTemplateName,
        SES_IDENTITY: sesEmailIdentityName
      }
    })
    // Subscribe the Order Processor Lambda to the Order Queue
    eventbriteOrderProcessorLambda.addEventSource(new SqsEventSource(eventbriteOrderQueue, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(30),
      maxConcurrency: 2
    }))
    eventbriteConfigStringParameter.grantRead(eventbriteOrderProcessorLambda)
    eventbriteOrderProcessorLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${region}:${accountId}:secret:dbuser-*`]
    }))
    eventbriteOrderProcessorLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ses:SendTemplatedEmail'],
      resources: [
        `arn:aws:ses:${region}:${accountId}:configuration-set/${sesConfigurationSetName}`,
        `arn:aws:ses:${region}:${accountId}:identity/${sesEmailIdentityName}`,
        `arn:aws:ses:${region}:${accountId}:template/${sesEventBriteNewRoleTemplateName}`
      ]
    }))

    // This Lambda will use the Eventbrite API to fetch all orders and store them in S3 as a JSON file per order
    const eventbriteFetchAllOrdersLambda = new NodeJs.NodejsFunction(this, 'EventbriteFetchAllOrders', {
      runtime: LambdaRuntime,
      entry: path.join(__dirname, '/../../assets/lambda/workers/eventbrite-fetch-all-orders.js'),
      architecture: Lambda.Architecture.X86_64,
      description: 'Fetches all Eventbrite orders.',
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(5),
      environment: {
        SNS_TOPIC: eventbriteOrderTopic.topicArn
      }
    })
    // Allow the lambda to publish to the SNS topic
    eventbriteOrderTopic.grantPublish(eventbriteFetchAllOrdersLambda)
    eventbriteApiSecret.grantRead(eventbriteFetchAllOrdersLambda)

    // Eventbrite Webhook
    // const eventbriteWebhookResource = apiV2.addResource('eventbrite-webhook')
    // const eventbriteWebhookIntegration = new ApiGateway.LambdaIntegration(eventbriteWebhookLambda, {
    //   requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    // })
    // eventbriteWebhookResource.addMethod(HTTPMethod.POST, eventbriteWebhookIntegration)
  }
}

module.exports = { ApiV2Service }
