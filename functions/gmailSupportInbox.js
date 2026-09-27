/* eslint-env node */
const {randomUUID} = require("node:crypto");

const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_MAILBOX = "support@charge.rent";
const DEFAULT_TOPIC = "chargerent-support-gmail";
const SYNC_COLLECTION = "supportMailboxSync";
const SYNC_DOCUMENT = "support-at-charge-rent";
const SERVICE_ACCOUNT_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

function text(value, maxLength = 12000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function base64UrlDecode(value) {
  const encoded = text(value, 200000).replace(/-/g, "+").replace(/_/g, "/");
  if (!encoded) return "";
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
  return Buffer.from(`${encoded}${padding}`, "base64").toString("utf8");
}

function headerMap(payload) {
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  return headers.reduce((result, header) => {
    const name = text(header?.name, 100).toLowerCase();
    if (name && !Object.prototype.hasOwnProperty.call(result, name)) {
      result[name] = text(header?.value, 4000);
    }
    return result;
  }, {});
}

function decodeEntities(value) {
  return String(value || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)));
}

function htmlToText(value) {
  return decodeEntities(String(value || "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
}

function collectBodies(part, result = {plain: [], html: []}) {
  if (!part || typeof part !== "object") return result;
  const mimeType = text(part.mimeType, 100).toLowerCase();
  const decoded = base64UrlDecode(part.body?.data);
  if (decoded && mimeType === "text/plain") result.plain.push(decoded);
  if (decoded && mimeType === "text/html") result.html.push(decoded);
  if (decoded && !mimeType && result.plain.length === 0) result.plain.push(decoded);
  (Array.isArray(part.parts) ? part.parts : []).forEach((child) => collectBodies(child, result));
  return result;
}

function trimQuotedReply(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
  const markers = [
    /^On .+wrote:\s*$/im,
    /^From:\s.+$/im,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
  ];
  let cutAt = normalized.length;
  markers.forEach((pattern) => {
    const index = normalized.search(pattern);
    if (index > 0) cutAt = Math.min(cutAt, index);
  });
  return normalized.slice(0, cutAt).trim().slice(0, 12000);
}

function parseAddress(value) {
  const normalized = text(value, 1000);
  const bracketed = normalized.match(/^(.*)<([^<>]+@[^<>]+)>/);
  if (bracketed) {
    return {
      name: text(bracketed[1].replace(/^\s*["']|["']\s*$/g, ""), 100),
      email: text(bracketed[2], 254).toLowerCase(),
    };
  }
  const email = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  return {name: "", email: email.toLowerCase()};
}

function isAutomatedMessage(headers, fromEmail) {
  const autoSubmitted = text(headers["auto-submitted"], 100).toLowerCase();
  const precedence = text(headers.precedence, 100).toLowerCase();
  return (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    Boolean(headers["x-autoreply"] || headers["x-autorespond"]) ||
    /^(?:mailer-daemon|postmaster)@/i.test(fromEmail);
}

function parseGmailMessage(message, mailbox = DEFAULT_MAILBOX) {
  const headers = headerMap(message?.payload);
  const from = parseAddress(headers.from);
  const to = parseAddress(headers.to || headers["delivered-to"]);
  const bodies = collectBodies(message?.payload);
  const rawBody = bodies.plain.find((value) => text(value)) || htmlToText(bodies.html.join("\n"));
  const receivedAt = Number(message?.internalDate) > 0 ?
    new Date(Number(message.internalDate)).toISOString() : new Date().toISOString();
  return {
    messageId: text(message?.id, 500),
    threadId: text(message?.threadId, 500),
    rfcMessageId: text(headers["message-id"], 500),
    inReplyTo: text(headers["in-reply-to"], 500),
    references: text(headers.references, 2000),
    ticketId: text(headers["x-chargerent-ticket"], 120),
    from: from.email,
    fromName: from.name,
    to: to.email || mailbox,
    subject: text(headers.subject, 300) || "Email inquiry",
    body: trimQuotedReply(rawBody),
    receivedAt,
    automated: isAutomatedMessage(headers, from.email),
    labelIds: Array.isArray(message?.labelIds) ? message.labelIds : [],
  };
}

function failure(code, message, status = 0) {
  return Object.assign(new Error(message), {code, status});
}

async function mapLimit(values, limit, iteratee) {
  const pending = [...values];
  const results = [];
  const workers = Array.from({length: Math.min(limit, pending.length)}, async () => {
    while (pending.length) {
      const value = pending.shift();
      results.push(await iteratee(value));
    }
  });
  await Promise.all(workers);
  return results;
}

function createGmailSupportInbox({
  admin,
  db,
  ticketService,
  fetchImpl = global.fetch,
  env = process.env,
  clock = () => Date.now(),
} = {}) {
  const projectId = text(admin?.app?.().options?.projectId || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT, 200);
  const mailbox = text(env.SUPPORT_GMAIL_INBOX || DEFAULT_MAILBOX, 254).toLowerCase();
  const topicName = text(env.SUPPORT_GMAIL_TOPIC || DEFAULT_TOPIC, 200);
  const defaultServiceAccount = projectId ?
    `chargerent-dashboard-mailer@${projectId}.iam.gserviceaccount.com` : "";
  const serviceAccount = text(env.GMAIL_MAILER_SERVICE_ACCOUNT_EMAIL || defaultServiceAccount, 254).toLowerCase();
  const topicPath = `projects/${projectId}/topics/${topicName}`;
  const stateRef = db?.collection?.(SYNC_COLLECTION).doc(SYNC_DOCUMENT);
  const configured = Boolean(
      admin && db && ticketService && typeof ticketService.importInboundEmail === "function" &&
      typeof fetchImpl === "function" && projectId && topicName &&
      SERVICE_ACCOUNT_RE.test(serviceAccount) && stateRef,
  );
  let cachedToken = null;

  async function fetchJson(url, options, stage) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: global.AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      throw failure("unavailable", `Gmail ${stage} did not respond.`, 0);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || !body || typeof body !== "object") {
      if (response.status === 401 || response.status === 403) {
        cachedToken = null;
        throw failure("authorization", "Gmail inbox authorization is not configured.", response.status);
      }
      if (response.status === 404 && stage === "history") {
        throw failure("history-expired", "Gmail history cursor expired.", response.status);
      }
      throw failure("unavailable", `Gmail ${stage} failed.`, response.status);
    }
    return body;
  }

  async function delegatedToken() {
    if (cachedToken && cachedToken.expiresAt > clock() + 60000) return cachedToken.value;
    let cloudAccessToken;
    try {
      const credential = admin.app().options.credential || admin.credential.applicationDefault();
      cloudAccessToken = (await credential.getAccessToken()).access_token;
    } catch {
      throw failure("authorization", "The dashboard cannot authorize Gmail inbox access.");
    }
    const now = Math.floor(clock() / 1000);
    const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signJwt`;
    const signed = await fetchJson(signUrl, {
      method: "POST",
      headers: {Authorization: `Bearer ${cloudAccessToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({payload: JSON.stringify({
        iss: serviceAccount,
        sub: mailbox,
        scope: GMAIL_READ_SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      })}),
    }, "authorization");
    const token = await fetchJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signed.signedJwt,
      }).toString(),
    }, "authorization");
    cachedToken = {
      value: token.access_token,
      expiresAt: clock() + Math.min(Number(token.expires_in) || 0, 3600) * 1000,
    };
    if (!cachedToken.value || cachedToken.expiresAt <= clock()) {
      throw failure("authorization", "Google did not issue a Gmail inbox token.");
    }
    return cachedToken.value;
  }

  async function gmailRequest(path, options = {}, stage = "request") {
    const accessToken = await delegatedToken();
    return fetchJson(`${GMAIL_API_ROOT}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? {"Content-Type": "application/json"} : {}),
        ...(options.headers || {}),
      },
    }, stage);
  }

  async function getProfile() {
    return gmailRequest(`/users/${encodeURIComponent(mailbox)}/profile`, {}, "profile");
  }

  async function getMessage(messageId) {
    const query = new URLSearchParams({format: "full"});
    return gmailRequest(
        `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}?${query}`,
        {},
        "message",
    );
  }

  async function processMessageId(messageId) {
    const parsed = parseGmailMessage(await getMessage(messageId), mailbox);
    const excludedLabels = new Set(["SENT", "DRAFT", "SPAM", "TRASH"]);
    if (!parsed.messageId || !parsed.from || !parsed.body || parsed.automated) {
      return {messageId, skipped: true, reason: "not-customer-mail"};
    }
    if (parsed.labelIds.some((label) => excludedLabels.has(label))) {
      return {messageId, skipped: true, reason: "excluded-label"};
    }
    if (parsed.from.endsWith("@charge.rent")) {
      return {messageId, skipped: true, reason: "company-sender"};
    }
    return ticketService.importInboundEmail(parsed);
  }

  async function processMessageIds(messageIds) {
    const unique = [...new Set(messageIds.map((value) => text(value, 500)).filter(Boolean))];
    return mapLimit(unique, 5, processMessageId);
  }

  async function bootstrapRecent() {
    const messageIds = [];
    let pageToken = "";
    let pages = 0;
    do {
      const query = new URLSearchParams({q: "in:inbox newer_than:14d", maxResults: "100"});
      if (pageToken) query.set("pageToken", pageToken);
      const response = await gmailRequest(
          `/users/${encodeURIComponent(mailbox)}/messages?${query}`,
          {},
          "message list",
      );
      (Array.isArray(response.messages) ? response.messages : []).forEach((message) => {
        if (message?.id) messageIds.push(message.id);
      });
      pageToken = text(response.nextPageToken, 1000);
      pages += 1;
    } while (pageToken && pages < 5);
    return processMessageIds(messageIds);
  }

  async function acquireLease() {
    const owner = randomUUID();
    let acquired = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      const state = snapshot.exists ? snapshot.data() || {} : {};
      if (Number(state.leaseUntilMs) > clock()) return;
      transaction.set(stateRef, {
        leaseOwner: owner,
        leaseUntilMs: clock() + 180000,
      }, {merge: true});
      acquired = true;
    });
    return acquired ? owner : "";
  }

  async function releaseLease(owner, error = null) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      if (!snapshot.exists || snapshot.data()?.leaseOwner !== owner) return;
      transaction.set(stateRef, {
        leaseOwner: "",
        leaseUntilMs: 0,
        ...(error ? {lastError: text(error.message, 500), lastErrorAtIso: new Date(clock()).toISOString()} : {
          lastError: "",
        }),
      }, {merge: true});
    });
  }

  async function historyMessageIds(startHistoryId) {
    const messageIds = [];
    let pageToken = "";
    let latestHistoryId = "";
    do {
      const query = new URLSearchParams({
        startHistoryId: String(startHistoryId),
        historyTypes: "messageAdded",
        labelId: "INBOX",
        maxResults: "100",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await gmailRequest(
          `/users/${encodeURIComponent(mailbox)}/history?${query}`,
          {},
          "history",
      );
      (Array.isArray(response.history) ? response.history : []).forEach((history) => {
        (Array.isArray(history.messagesAdded) ? history.messagesAdded : []).forEach((entry) => {
          if (entry?.message?.id) messageIds.push(entry.message.id);
        });
      });
      latestHistoryId = text(response.historyId, 100) || latestHistoryId;
      pageToken = text(response.nextPageToken, 1000);
    } while (pageToken);
    return {messageIds, latestHistoryId};
  }

  async function syncMailbox({targetHistoryId = ""} = {}) {
    if (!configured) throw failure("configuration", "Gmail inbox synchronization is not configured.");
    const leaseOwner = await acquireLease();
    if (!leaseOwner) return {ok: true, skipped: true, reason: "sync-in-progress"};
    try {
      const snapshot = await stateRef.get();
      const state = snapshot.exists ? snapshot.data() || {} : {};
      const profile = targetHistoryId ? null : await getProfile();
      const target = text(targetHistoryId, 100) || text(profile?.historyId, 100);
      if (!target) throw failure("unavailable", "Gmail did not provide a history cursor.");

      let results = [];
      let nextHistoryId = target;
      if (!text(state.historyId, 100)) {
        results = await bootstrapRecent();
      } else if (String(state.historyId) !== String(target)) {
        try {
          const history = await historyMessageIds(state.historyId);
          results = await processMessageIds(history.messageIds);
          nextHistoryId = history.latestHistoryId || target;
        } catch (error) {
          if (error?.code !== "history-expired") throw error;
          results = await bootstrapRecent();
          nextHistoryId = target;
        }
      }

      await stateRef.set({
        mailbox,
        historyId: String(nextHistoryId),
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncedAtIso: new Date(clock()).toISOString(),
        lastProcessedCount: results.filter((result) => !result?.skipped && !result?.duplicate).length,
        lastSeenCount: results.length,
      }, {merge: true});
      await releaseLease(leaseOwner);
      return {ok: true, historyId: String(nextHistoryId), results};
    } catch (error) {
      await releaseLease(leaseOwner, error);
      throw error;
    }
  }

  async function renewWatch() {
    if (!configured) throw failure("configuration", "Gmail inbox synchronization is not configured.");
    const watch = await gmailRequest(`/users/${encodeURIComponent(mailbox)}/watch`, {
      method: "POST",
      body: JSON.stringify({
        topicName: topicPath,
        labelIds: ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      }),
    }, "watch");
    const sync = await syncMailbox({targetHistoryId: text(watch.historyId, 100)});
    await stateRef.set({
      mailbox,
      topicPath,
      watchExpirationMs: Number(watch.expiration) || 0,
      watchRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
      watchRenewedAtIso: new Date(clock()).toISOString(),
    }, {merge: true});
    return {ok: true, historyId: text(watch.historyId, 100), expiration: text(watch.expiration, 100), sync};
  }

  async function handleNotification(payload) {
    const emailAddress = text(payload?.emailAddress, 254).toLowerCase();
    if (emailAddress && emailAddress !== mailbox) {
      return {ok: true, skipped: true, reason: "unexpected-mailbox"};
    }
    return syncMailbox({targetHistoryId: text(payload?.historyId, 100)});
  }

  return {
    getStatus: () => ({configured, mailbox, projectId, serviceAccount, topicPath, scope: GMAIL_READ_SCOPE}),
    handleNotification,
    renewWatch,
    syncMailbox,
  };
}

module.exports = {
  DEFAULT_MAILBOX,
  DEFAULT_TOPIC,
  GMAIL_READ_SCOPE,
  createGmailSupportInbox,
  htmlToText,
  parseAddress,
  parseGmailMessage,
  trimQuotedReply,
};
