/* eslint-env node */
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {normalizePublicSubmission} = require("../supportTickets");

function cleanText(value, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(input || "[]");
  if (!Array.isArray(parsed) || parsed.length > 100) {
    throw new Error("Expected an array containing at most 100 support tickets.");
  }
  return parsed;
}

function recoveredMessageId(gmailMessageId) {
  const digest = crypto.createHash("sha256").update(gmailMessageId).digest("hex").slice(0, 40);
  return `recovered-${digest}`;
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const payloads = await readStdin();
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const summary = {mode: shouldWrite ? "write" : "check", total: payloads.length, created: [], existing: [], invalid: []};

  for (const payload of payloads) {
    const ticketId = cleanText(payload?.quoteId, 120);
    try {
      const submittedAt = new Date(cleanText(payload?.submittedAt, 80));
      if (!ticketId || Number.isNaN(submittedAt.getTime())) throw new Error("Ticket ID or submission time is invalid.");
      const timestamp = admin.firestore.Timestamp.fromDate(submittedAt);
      const normalized = normalizePublicSubmission(payload, {
        createdAt: timestamp,
        createdAtIso: submittedAt.toISOString(),
      });
      const ticketRef = db.collection("supportTickets").doc(normalized.id);
      const snapshot = await ticketRef.get();
      if (snapshot.exists) {
        summary.existing.push(normalized.id);
        continue;
      }
      if (!shouldWrite) {
        summary.created.push(normalized.id);
        continue;
      }

      const gmailMessageId = cleanText(payload?.recovery?.gmailMessageId, 500);
      const gmailThreadId = cleanText(payload?.recovery?.gmailThreadId, 500);
      const messageRef = ticketRef.collection("messages").doc(recoveredMessageId(gmailMessageId || normalized.id));
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ticketRef);
        if (current.exists) return;
        transaction.set(ticketRef, {
          ...normalized.ticket,
          recovery: {
            channel: "gmail",
            gmailMessageId,
            gmailThreadId,
            recoveredAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
        transaction.set(messageRef, {
          type: "form_submission",
          direction: "inbound",
          channel: "website",
          body: normalized.ticket.message || "Website form submitted without an additional message.",
          from: normalized.ticket.customer.email,
          externalMessageId: gmailMessageId,
          createdAt: timestamp,
          createdAtIso: submittedAt.toISOString(),
        });
      });
      summary.created.push(normalized.id);
    } catch (error) {
      summary.invalid.push({ticketId, error: cleanText(error?.message, 300) || "Import failed"});
    }
  }

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.invalid.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Support ticket import failed: ${cleanText(error?.message, 300) || "unknown error"}\n`);
  process.exitCode = 1;
});
