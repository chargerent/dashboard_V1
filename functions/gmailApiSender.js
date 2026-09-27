/* eslint-env node */
const {randomUUID} = require("node:crypto");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SERVICE_ACCOUNT_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeHeader(value, limit = 998) {
  return text(value).replace(/[\r\n]+/g, " ").slice(0, limit);
}

function encodeHeader(value) {
  const normalized = safeHeader(value);
  if (/^[\x20-\x7E]*$/.test(normalized)) return normalized;
  return `=?UTF-8?B?${Buffer.from(normalized, "utf8").toString("base64")}?=`;
}

function wrapBase64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
}

function failure(code, message) {
  return Object.assign(new Error(message), {code});
}

function validateEmail(value, label) {
  const normalized = text(value).toLowerCase();
  if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
    throw failure("invalid-argument", `${label} is not a valid email address.`);
  }
  return normalized;
}

function messageReference(value, limit = 2000) {
  return safeHeader(value, limit).replace(/[^\x20-\x7E]/g, "");
}

function buildRawMessage({
  fromName,
  fromEmail,
  replyTo,
  to,
  subject,
  textBody,
  htmlBody,
  date,
  boundary,
  inReplyTo,
  references,
  ticketId,
}) {
  const sender = validateEmail(fromEmail, "Sender email");
  const recipient = validateEmail(to, "Recipient email");
  const replyAddress = validateEmail(replyTo || fromEmail, "Reply-to email");
  const safeSubject = encodeHeader(subject);
  if (!safeSubject) throw failure("invalid-argument", "Email subject is required.");
  if (!text(textBody)) throw failure("invalid-argument", "Email body is required.");

  const mimeBoundary = safeHeader(boundary || `chargerent_${randomUUID().replace(/-/g, "")}`, 120);
  const senderName = encodeHeader(fromName || sender);
  const lines = [
    `From: ${senderName} <${sender}>`,
    `Reply-To: ${replyAddress}`,
    `To: ${recipient}`,
    `Subject: ${safeSubject}`,
    `Date: ${(date instanceof Date ? date : new Date(date || Date.now())).toUTCString()}`,
    ...(messageReference(inReplyTo, 500) ? [`In-Reply-To: ${messageReference(inReplyTo, 500)}`] : []),
    ...(messageReference(references) ? [`References: ${messageReference(references)}`] : []),
    ...(safeHeader(ticketId, 120) ? [`X-Chargerent-Ticket: ${safeHeader(ticketId, 120)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${mimeBoundary}"`,
    "",
    `--${mimeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(textBody),
    `--${mimeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(htmlBody || textBody),
    `--${mimeBoundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

function createGmailApiSender({admin, fetchImpl = global.fetch, env = process.env, clock = () => Date.now()} = {}) {
  const projectId = text(admin?.app?.().options?.projectId || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT);
  const defaultServiceAccount = projectId ? `chargerent-dashboard-mailer@${projectId}.iam.gserviceaccount.com` : "";
  const serviceAccount = text(env.GMAIL_MAILER_SERVICE_ACCOUNT_EMAIL || defaultServiceAccount).toLowerCase();
  const configured = Boolean(admin && typeof fetchImpl === "function" && SERVICE_ACCOUNT_RE.test(serviceAccount));
  const tokenCache = new Map();

  async function fetchJson(url, options, stage) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: global.AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw failure("unavailable", `Gmail ${stage} did not respond. Try again.`);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || !body || typeof body !== "object") {
      if (stage === "authorization" || response.status === 401 || response.status === 403) {
        tokenCache.clear();
        throw failure("failed-precondition", "Gmail API authorization is not configured for this sender.");
      }
      throw failure("unavailable", "Gmail did not confirm the email send. Review the ticket activity before retrying.");
    }
    return body;
  }

  async function delegatedToken(senderEmail) {
    const cached = tokenCache.get(senderEmail);
    if (cached && cached.expiresAt > clock() + 60000) return cached.value;

    let cloudAccessToken;
    try {
      const credential = admin.app().options.credential || admin.credential.applicationDefault();
      cloudAccessToken = (await credential.getAccessToken()).access_token;
    } catch {
      throw failure("failed-precondition", "The dashboard cannot authorize the Gmail API sender.");
    }
    if (!cloudAccessToken) {
      throw failure("failed-precondition", "The dashboard Gmail API authorization is unavailable.");
    }

    const now = Math.floor(clock() / 1000);
    const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signJwt`;
    const signed = await fetchJson(signUrl, {
      method: "POST",
      headers: {Authorization: `Bearer ${cloudAccessToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({payload: JSON.stringify({
        iss: serviceAccount,
        sub: senderEmail,
        scope: GMAIL_SEND_SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      })}),
    }, "authorization");
    if (!signed.signedJwt) {
      throw failure("failed-precondition", "The dashboard Gmail signing permission is incomplete.");
    }

    const token = await fetchJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signed.signedJwt,
      }).toString(),
    }, "authorization");
    if (!token.access_token || !(Number(token.expires_in) > 0)) {
      throw failure("failed-precondition", "Google did not issue a Gmail API access token.");
    }
    const cachedToken = {
      value: token.access_token,
      expiresAt: clock() + Math.min(Number(token.expires_in), 3600) * 1000,
    };
    tokenCache.set(senderEmail, cachedToken);
    return cachedToken.value;
  }

  async function sendMessage({
    fromName,
    fromEmail,
    replyTo,
    to,
    subject,
    textBody,
    htmlBody,
    gmailThreadId,
    inReplyTo,
    references,
    ticketId,
  }) {
    if (!configured) {
      throw failure("failed-precondition", "The dashboard Gmail API sender is not configured.");
    }
    const senderEmail = validateEmail(fromEmail, "Sender email");
    const rawMessage = buildRawMessage({
      fromName,
      fromEmail: senderEmail,
      replyTo,
      to,
      subject,
      textBody,
      htmlBody,
      date: new Date(clock()),
      inReplyTo,
      references,
      ticketId,
    });
    const accessToken = await delegatedToken(senderEmail);
    const result = await fetchJson(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        raw: base64Url(rawMessage),
        ...(text(gmailThreadId) ? {threadId: text(gmailThreadId)} : {}),
      }),
    }, "send");
    if (!text(result.id)) {
      throw failure("unavailable", "Gmail did not return a message ID. Review the ticket activity before retrying.");
    }
    return {messageId: result.id, threadId: text(result.threadId)};
  }

  return {
    getStatus: () => ({configured, serviceAccount, scope: GMAIL_SEND_SCOPE}),
    sendMessage,
  };
}

module.exports = {
  GMAIL_SEND_SCOPE,
  buildRawMessage,
  createGmailApiSender,
};
