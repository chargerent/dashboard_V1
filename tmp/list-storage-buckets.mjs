import fs from "node:fs";
import https from "node:https";

const raw = JSON.parse(
  fs.readFileSync(`${process.env.HOME}/.config/configstore/firebase-tools.json`, "utf8"),
);
const token = raw?.tokens?.access_token;

if (!token) {
  console.error("missing access token");
  process.exit(1);
}

const url = "https://storage.googleapis.com/storage/v1/b?project=node-red-alerts";

https.get(url, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
}, (res) => {
  let body = "";
  res.on("data", (chunk) => {
    body += chunk;
  });
  res.on("end", () => {
    console.log("status", res.statusCode);
    try {
      const data = JSON.parse(body);
      const items = Array.isArray(data?.items) ?
        data.items.map((bucket) => ({
          name: bucket.name,
          location: bucket.location,
          storageClass: bucket.storageClass,
        })) :
        data;
      console.log(JSON.stringify(items, null, 2));
    } catch {
      console.log(body);
    }
  });
}).on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
