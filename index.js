// index.mjs
import webpush from "web-push";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "UserSubscriptions";

// TODO: Replace with your real VAPID keys
const VAPID_KEYS = {
  publicKey:
    "BC7UDAdHUM4KddAC_GKZlN-o5bHM_htTNDzADuFQy2il1sTAG2vFi8MhQFE_wIzWT7CCvBhtvbkJWi8TC7YRvNg",
  privateKey: "cq2E2S_psKem0vMRADxUjHREpUxdcEVwObrI5kPCKp8",
};

webpush.setVapidDetails(
  "mailto:tech@enyconsulting.ca",
  VAPID_KEYS.publicKey,
  VAPID_KEYS.privateKey
);

export const handler = async (event) => {
  try {
    console.log("Incoming Event:", JSON.stringify(event));

    const path = event.rawPath || event.path; // depends on Lambda URL vs API Gateway
    const method = event.requestContext?.http?.method || event.httpMethod;

    // -------- Route: /vapid --------
    if (path.endsWith("/vapid") && method === "GET") {
      const vapidKeys = webpush.generateVAPIDKeys();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vapidKeys),
      };
    }

    // -------- Route: /subscribe --------
    // -------- Route: /subscribe --------
    if (path.endsWith("/subscribe") && method === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};

      const { userId, deviceId, subscription } = body;
      if (!userId || !deviceId || !subscription) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Missing userId, deviceId, or subscription",
          }),
        };
      }

      // Save subscription to DynamoDB
      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          userId, // <-- PK
          deviceId, // <-- SK (if table is composite key)
          subscription,
          createdAt: new Date().toISOString(),
        },
      });

      const sending = await docClient.send(command);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({
          message: "Subscription saved successfully",
          data: sending,
        }),
      };
    }

    // -------- Route: /notify --------
    if (path.endsWith("/notify") && method === "POST") {
      //   const params = event.queryStringParameters || {};
      const body = event.body ? JSON.parse(event.body) : {};
      const { userId, message } = body;

      if (!userId || !message) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Missing userId or message in query params",
          }),
        };
      }

      // Get all subscriptions for the user
      const query = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: {
          ":uid": userId,
        },
      });

      const result = await docClient.send(query);

      if (!result.Items || result.Items.length === 0) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "No subscriptions found for this userId",
          }),
        };
      }

      // Send notification to all devices
      const sendResults = [];
      const sentData = [];
      for (const item of result.Items) {
        try {
          const sendPush = await webpush.sendNotification(
            item.subscription,
            JSON.stringify({
              title: "New Message",
              body: {
                title: "System Update",
                message,
                body: "Multiple components need to be refreshed",
                action: "refetch",
                target: "dashboard", // Primary target
                payload: {
                  additionalActions: [
                    { action: "refetch", target: "userList" },
                    { action: "update", target: "notifications" },
                  ],
                  updateReason: "system_update",
                },
              },
            })
          );
          sendResults.push({ deviceId: item.deviceId, status: "sent" });
          sentData.push(sendPush);
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            // Subscription is no longer valid, delete from DynamoDB
            await docClient.send(
              new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { userId: item.userId, deviceId: item.deviceId },
              })
            );
          }
          sendResults.push({
            deviceId: item.deviceId,
            status: "failed",
            error: err.message,
          });
        }
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Notifications attempted",
          results: sendResults,
          sentData,
        }),
      };
    }

    // -------- Route: /test-notification --------

    if (path.endsWith("/test-notification") && method === "GET") {
    }

    // -------- Default (route not found) --------
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Route not found" }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
