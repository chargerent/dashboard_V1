/* eslint-env node */
const {randomUUID} = require("node:crypto");

const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const SIGN_IN_URL = "https://mail.google.com/";

const text = (value) => typeof value === "string" ? value.trim() : "";
const email = (value) => text(value).toLowerCase();

function isValidWorkspaceContactEmail(value, {companyEmail = ""} = {}) {
  const normalized = email(value);
  return normalized.length > 0 && normalized.length <= 254 && normalized.split("@")[0].length <= 64 &&
    EMAIL_RE.test(normalized) && normalized !== email(companyEmail);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function summary(notification) {
  return {
    notificationStatus: notification.status,
    ...(notification.recipient ? {notificationEmail: notification.recipient} : {}),
    notificationMessage: notification.message,
  };
}

function unknown(recipient) {
  return {
    status: "unknown",
    recipient,
    message: "The company address email may have been sent. Check before confirming a resend, which could send a duplicate.",
  };
}

function knownSendFailure(error) {
  if (error && error.notificationBeforeSend === true) return true;
  const code = text(error && error.code).toUpperCase();
  const command = text(error && error.command).toUpperCase();
  if (["FAILED-PRECONDITION", "EAUTH", "ENOAUTH", "EOAUTH2", "EDNS", "ECONFIG", "EENVELOPE"].includes(code)) return true;
  if (/^(CONN|EHLO|HELO|STARTTLS|AUTH(?:\s|$)|MAIL FROM|RCPT TO)/.test(command)) return true;
  // An explicit negative DATA response is a rejection; a DATA timeout is ambiguous.
  return command === "DATA" && Number(error.responseCode) >= 400 && Number(error.responseCode) < 600;
}

function buildNotice(intent) {
  const name = [text(intent.givenName), text(intent.familyName)].filter(Boolean).join(" ") || "there";
  const activation = intent.mailboxStatus === "pending"
    ? "Your Google account has been created. Gmail activation is still pending; you may need to wait before using the mailbox."
    : "Your Google account has been created and Google confirms that the mailbox is set up.";
  const paragraphs = [
    `Hi ${name},`,
    `Your Chargerent company email address is ${intent.accountEmail}.`,
    activation,
    `Sign in to Gmail: ${SIGN_IN_URL}`,
    "Your first sign-in details will be supplied separately.",
    "Chargerent",
  ];
  return {
    to: intent.recipient,
    subject: "Your Chargerent company email address",
    body: paragraphs.join("\n\n"),
    html: `<div>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p><a href="${SIGN_IN_URL}">Open Gmail</a></p></div>`,
  };
}

/** Send only a company-address notice through the existing injected Gmail transport. */
function createWorkspaceNotification({db, sendEmail, now = Date.now, leaseMs = 5 * 60 * 1000}) {
  function writeNotification(transaction, recordRef, profileRef, notification) {
    transaction.update(recordRef, {notification});
    transaction.update(profileRef, {
      "workspaceMailbox.notificationStatus": notification.status,
      "workspaceMailbox.notificationEmail": notification.recipient,
      "workspaceMailbox.notificationMessage": notification.message,
    });
  }

  async function notify({uid, mailbox, actorUid, resendUnknown = false}) {
    if (!text(uid) || typeof uid !== "string" || uid.includes("/")) {
      return summary({status: "error", message: "A valid saved partner account is required to send the company address email."});
    }
    const recordRef = db.collection("workspaceProvisioning").doc(uid);
    const profileRef = db.collection("users").doc(uid);
    let claim;
    try {
      claim = await db.runTransaction(async (transaction) => {
        const recordSnap = await transaction.get(recordRef);
        const profileSnap = await transaction.get(profileRef);
        const record = recordSnap.exists ? recordSnap.data() : null;
        if (!record || !profileSnap.exists || record.request?.role !== "partner" || profileSnap.data().role !== "partner") {
          return {result: {status: "error", message: "The saved account must be a partner with a company email request."}};
        }
        const recipient = email(record.contactEmail);
        if (!isValidWorkspaceContactEmail(recipient, {companyEmail: record.email})) {
          return {result: {status: "error", message: "A valid existing partner contact email is required before the company address can be emailed."}};
        }
        if (!["ready", "pending"].includes(record.status) || !["ready", "pending"].includes(mailbox?.status) ||
            !record.googleUserId || record.googleUserId !== mailbox?.googleUserId ||
            !isValidWorkspaceContactEmail(record.email) || email(record.email) !== email(mailbox?.email) ||
            email(record.request.email) !== email(record.email)) {
          return {result: {status: "pending", recipient, message: "The company address email will be sent after the partner's Google account is confirmed."}};
        }
        const previous = record.notification || {};
        if ((previous.recipient && previous.recipient !== recipient) ||
            (previous.accountEmail && previous.accountEmail !== record.email) ||
            (previous.googleUserId && previous.googleUserId !== record.googleUserId)) {
          return {result: {status: "error", recipient, message: "The saved company address notification details have changed. Review the original request before sending."}};
        }
        if (previous.status === "sent") return {result: previous};
        if (previous.phase === "sending" && previous.leaseExpiresAt > now()) {
          return {result: {status: "pending", recipient, message: "The company address email is being sent. Check its status shortly."}};
        }
        const ambiguous = previous.status === "unknown" || previous.phase === "sending";
        if (ambiguous && resendUnknown !== true) {
          const next = {...previous, ...unknown(recipient), updatedAt: now(), leaseExpiresAt: 0};
          writeNotification(transaction, recordRef, profileRef, next);
          return {result: next};
        }
        const timestamp = now();
        const notification = {
          status: "pending",
          phase: "sending",
          recipient,
          accountEmail: previous.accountEmail || record.email,
          googleUserId: previous.googleUserId || record.googleUserId,
          givenName: previous.givenName ?? text(record.request.givenName),
          familyName: previous.familyName ?? text(record.request.familyName),
          mailboxStatus: previous.mailboxStatus || record.status,
          message: "The company address email is being sent. Check its status shortly.",
          attemptId: randomUUID(),
          attempts: Number(previous.attempts || 0) + 1,
          createdAt: previous.createdAt || timestamp,
          updatedAt: timestamp,
          leaseExpiresAt: timestamp + leaseMs,
          ...(text(actorUid) ? {actorUid: text(actorUid)} : {}),
          ...(ambiguous ? {resendConfirmedAt: timestamp} : {}),
        };
        writeNotification(transaction, recordRef, profileRef, notification);
        return {notification};
      });
    } catch {
      return summary({status: "error", message: "The company address email could not be queued. Retry the notification."});
    }
    if (claim.result) return summary(claim.result);
    const intent = claim.notification;
    let outcome;
    try {
      const result = await sendEmail(buildNotice(intent));
      const accepted = Array.isArray(result?.accepted) && result.accepted.some((address) => email(typeof address === "object" ? address.address : address) === intent.recipient);
      const rejected = Array.isArray(result?.rejected) && result.rejected.some((address) => email(typeof address === "object" ? address.address : address) === intent.recipient);
      if (accepted && !rejected) {
        outcome = {
          status: "sent", recipient: intent.recipient,
          message: `Company address email sent to ${intent.recipient}.`,
          // Keep only the nonsecret message identifier, never the SMTP response body.
          ...(typeof result.messageId === "string" && result.messageId.length <= 998 ? {messageId: result.messageId} : {}),
        };
      } else if (rejected && !accepted) {
        outcome = {status: "error", recipient: intent.recipient, message: "The contact email address was rejected. Verify that address before retrying the notification."};
      } else {
        outcome = unknown(intent.recipient);
      }
    } catch (error) {
      outcome = knownSendFailure(error)
        ? {status: "error", recipient: intent.recipient, message: "The company address email was not sent. Check the contact address and Gmail sender configuration, then retry the notification."}
        : unknown(intent.recipient);
    }
    const savedOutcome = await finish(intent, outcome, recordRef, profileRef);
    if (savedOutcome) return summary(savedOutcome);
    // SMTP and Firestore cannot commit atomically. Preserve uncertainty to avoid an automatic duplicate.
    const uncertain = {
      ...unknown(intent.recipient),
      ...(outcome.status === "sent" ? {
        smtpAcceptedAt: now(),
        ...(outcome.messageId ? {messageId: outcome.messageId} : {}),
      } : {}),
    };
    const recoveredOutcome = await finish(intent, uncertain, recordRef, profileRef);
    return summary(recoveredOutcome || uncertain);
  }

  async function finish(intent, outcome, recordRef, profileRef) {
    try {
      return await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(recordRef);
        const current = snapshot.exists ? snapshot.data().notification : null;
        if (!current || current.attemptId !== intent.attemptId) return null;
        // A write can commit before its acknowledgement is lost. Preserve its
        // verified final result and message ID instead of replacing it with uncertainty.
        if (current.phase === "complete" && ["sent", "error", "unknown"].includes(current.status)) return current;
        const notification = {
          ...intent,
          ...outcome,
          phase: "complete",
          leaseExpiresAt: 0,
          updatedAt: now(),
          ...(outcome.status === "sent" ? {sentAt: now()} : {}),
        };
        writeNotification(transaction, recordRef, profileRef, notification);
        return notification;
      });
    } catch {
      return null;
    }
  }

  return {notify};
}

module.exports = {createWorkspaceNotification, isValidWorkspaceContactEmail};
