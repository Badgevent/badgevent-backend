# Welcome to your CDK JavaScript project

This is a blank project for CDK development with JavaScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app. The build step is not required when using JavaScript.

## Useful commands

* `npm run test`         perform the jest unit tests
* `cdk deploy`           deploy this stack to your default AWS account/region
* `cdk diff`             compare deployed stack with current state
* `cdk synth`            emits the synthesized CloudFormation template



# Workflow

EventbriteFetchAllOrdersLambda -> EventbriteOrdersQueue
EventbriteWebhookLambda -> EventbriteOrderQueue
EventbriteOrderQueue -> EventbriteProcessOrderLambda


# Folder Structure

/
├── assets/                                         (code and config referenced by infra)
│   └── email/                                      (email templates)
│   └── lambda/                                     (lambda code)
│       ├── lib/                                    (shared lambda code)
│       └── endpoints/                              (lambda api endpoints)
│       └── workers/                                (lambda event processrs and cron workers)
├── bin/                                            (utility scripts)
├── lib/                                            (cdk code)
│   ├── aspects/                                    (cdk aspects)
│   ├── constructs/                                 (cdk constructs)
│   └── stacks/                                     (cdk stacks)
└── main.js