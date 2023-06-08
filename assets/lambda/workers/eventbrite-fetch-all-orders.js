// This Lambda will use the Eventbrite API to fetch all orders and store them in S3 as a JSON file per order
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import eventbrite from "eventbrite";

const SecretName = "eventbrite-api";

async function _getEventbriteSecrets() {
  const client = new SecretsManagerClient({
    region: "us-east-1",
  });

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: SecretName,
      VersionStage: "AWSCURRENT",
    })
  );

  const Secret = JSON.parse(response.SecretString);
  return Secret;
}

async function _publishToSns(topicArn, message) {
  const client = new SNSClient();
  const input = {
    TopicArn: topicArn,
    Message: message,
    Subject: "Eventbrite Order",
  };
  // console.log('Publishing to SNS: ' + JSON.stringify(input))
  const command = new PublishCommand(input);
  const response = await client.send(command);
  console.log(
    `SNS Published: topicArn=${topicArn} messageId:${response.MessageId} messageLength=${message.length}`
  );
}

export const handler = async (event, context, callback) => {
  console.log("ENVIRONMENT VARIABLES\n" + JSON.stringify(process.env, null, 2));
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  const Secret = await _getEventbriteSecrets();
  // console.log('OathToken=' + Secret.OathToken)
  console.log("EventId=" + Secret.EventId);

  const ebSdk = eventbrite({ token: Secret.OathToken });
  let continuation;
  do {
    const ebUrl =
      continuation === undefined
        ? `/events/${Secret.EventId}/orders/?expand=attendees`
        : `/events/${Secret.EventId}/orders/?expand=attendees&continuation=${continuation}`;
    const response = await ebSdk.request(ebUrl);
    console.log(JSON.stringify(response.pagination));
    continuation = response.pagination.has_more_items
      ? response.pagination.continuation
      : undefined;
    for (const order of response.orders) {
      const orderId = order.id;
      const orderStr = JSON.stringify(order, null, 2);
      console.log("orderId=" + orderId + " len=" + orderStr.length);
      await _publishToSns(process.env.SNS_TOPIC, orderStr);
    }
  } while (continuation !== undefined);
  return context.logStreamName;
};
