/* eslint-env node */
const crypto = require("node:crypto");

class BesiterGatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BesiterGatewayError";
    this.code = code;
  }
}

function cleanString(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseCredentials(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      throw new BesiterGatewayError(
          "invalid-credentials",
          "BESITER_MQTT_CREDENTIALS must be valid JSON.",
      );
    }
  }
  const username = cleanString(parsed && parsed.username, 200);
  const password = cleanString(parsed && parsed.password, 500);
  if (!username || !password) {
    throw new BesiterGatewayError(
        "invalid-credentials",
        "Besiter MQTT credentials are not configured.",
    );
  }
  return {username, password};
}

function parsePayload(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
  } catch (_error) {
    return null;
  }
}

function createMqttBesiterGateway({
  brokerUrl,
  credentials,
  connect,
  requestTimeoutMs = 12_000,
}) {
  const url = cleanString(brokerUrl, 500);
  if (!/^mqtts?:\/\//i.test(url)) {
    throw new BesiterGatewayError("invalid-broker", "A valid Besiter MQTT broker URL is required.");
  }
  if (typeof connect !== "function") {
    throw new TypeError("An MQTT connect function is required.");
  }
  const auth = parseCredentials(credentials);

  function clientOptions() {
    return {
      ...auth,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 8_000,
      clientId: `chargerent-terminal-${crypto.randomBytes(8).toString("hex")}`,
    };
  }

  function requestResponse(payload) {
    const stationId = cleanString(payload.stationid, 80).toUpperCase();
    const requestId = cleanString(payload.requestId, 160);
    const responseTopic = `CSTA/post/${stationId}`;

    return new Promise((resolve, reject) => {
      const client = connect(url, clientOptions());
      let settled = false;
      const timer = setTimeout(() => {
        finish(new BesiterGatewayError(
            "availability-timeout",
            "The V2 kiosk did not return current availability in time.",
        ));
      }, requestTimeoutMs);

      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          client.end(true);
        } catch (_error) {
          // The original result is more useful than a cleanup error.
        }
        if (error) reject(error);
        else resolve(result);
      }

      client.once("error", (error) => finish(new BesiterGatewayError(
          "mqtt-error",
          `The Besiter gateway connection failed: ${error.message}`,
      )));
      client.on("message", (topic, rawPayload) => {
        if (topic !== responseTopic) return;
        const response = parsePayload(rawPayload);
        if (!response || cleanString(response.action, 20).toLowerCase() !== "status") return;
        if (cleanString(response.stationid, 80).toUpperCase() !== stationId) return;
        if (cleanString(response.requestId, 160) !== requestId) return;
        finish(null, response);
      });
      client.once("connect", () => {
        client.subscribe(responseTopic, {qos: 2}, (subscribeError) => {
          if (subscribeError) {
            finish(new BesiterGatewayError(
                "mqtt-subscribe-failed",
                "The Besiter availability response channel could not be opened.",
            ));
            return;
          }
          client.publish("CSTA/get", JSON.stringify(payload), {qos: 2}, (publishError) => {
            if (publishError) {
              finish(new BesiterGatewayError(
                  "mqtt-publish-failed",
                  "The Besiter availability request could not be sent.",
              ));
            }
          });
        });
      });
    });
  }

  function publish(payload) {
    return new Promise((resolve, reject) => {
      const client = connect(url, clientOptions());
      let settled = false;
      const timer = setTimeout(() => finish(new BesiterGatewayError(
          "mqtt-publish-timeout",
          "The Besiter vend request could not be queued in time.",
      )), requestTimeoutMs);

      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          client.end(true);
        } catch (_error) {
          // The original result is more useful than a cleanup error.
        }
        if (error) reject(error);
        else resolve();
      }

      client.once("error", (error) => finish(new BesiterGatewayError(
          "mqtt-error",
          `The Besiter gateway connection failed: ${error.message}`,
      )));
      client.once("connect", () => {
        client.publish("CSTA/get", JSON.stringify(payload), {qos: 2}, (error) => {
          finish(error ? new BesiterGatewayError(
              "mqtt-publish-failed",
              "The Besiter vend request could not be sent.",
          ) : null);
        });
      });
    });
  }

  return {
    requestAvailability({stationId, requestId, requestedAt}) {
      return requestResponse({
        action: "status",
        stationid: cleanString(stationId, 80).toUpperCase(),
        requestId: cleanString(requestId, 160),
        timerequested: Number(requestedAt),
      });
    },
    sendVend(request) {
      return publish({
        ...request,
        action: "vend",
        stationid: cleanString(request.stationid, 80).toUpperCase(),
        requestId: cleanString(request.requestId, 160),
        timerequested: Number(request.timerequested),
      });
    },
  };
}

module.exports = {
  BesiterGatewayError,
  createMqttBesiterGateway,
  parseCredentials,
};
