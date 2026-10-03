/* eslint-env node */

const crypto = require("node:crypto");
const {
  memberCanReceiveSupportNumber,
  normalizeE164,
  ticketCallSupportNumbers,
} = require("./supportTelephony");

const DEVICE_COLLECTION = "supportMobileDevices";
const NOTIFICATION_COLLECTION = "supportMobileNotifications";
const STATE_COLLECTION = "supportMobileNotificationState";
const NOTIFICATION_TYPES = new Set(["missed_call", "text", "case"]);
const DESTINATIONS = new Set(["missed_calls", "messages", "cases"]);

function cleanText(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePushToken(value) {
  const token = cleanText(value, 4096);
  if (token.length < 20 || /\s/.test(token)) throw new Error("The notification token is invalid.");
  return token;
}

function normalizeNotificationType(value) {
  const type = cleanText(value, 40).toLowerCase();
  if (!NOTIFICATION_TYPES.has(type)) throw new Error("The notification type is invalid.");
  return type;
}

function normalizeDestination(value, type) {
  const destination = cleanText(value, 40).toLowerCase() || ({
    missed_call: "missed_calls",
    text: "messages",
    case: "cases",
  })[type];
  if (!DESTINATIONS.has(destination)) throw new Error("The notification destination is invalid.");
  return destination;
}

function safeSupportNumber(value) {
  try {
    return normalizeE164(value, {allowEmpty: true});
  } catch {
    return "";
  }
}

function hashedDocumentId(...parts) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function eligibleNotificationRecipients(staff = [], supportNumber = "", fallbackNumber = "") {
  const normalizedSupportNumber = safeSupportNumber(supportNumber);
  const recipients = new Map();
  for (const member of staff) {
    const userUid = cleanText(member?.userUid, 160);
    if (!userUid || member?.enabled === false) continue;
    if (normalizedSupportNumber &&
        !memberCanReceiveSupportNumber(member, normalizedSupportNumber, fallbackNumber)) continue;
    if (!normalizedSupportNumber && member?.allSupportNumbers !== true) continue;
    recipients.set(userUid, member);
  }
  return [...recipients.values()];
}

function isPermanentTokenError(code) {
  return new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]).has(cleanText(code, 120));
}

function createSupportNotificationService({
  db,
  admin,
  listRoutingStaff,
  clock = () => new Date(),
}) {
  if (!db || !admin || typeof listRoutingStaff !== "function") {
    throw new Error("Support notification dependencies are required.");
  }
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function registerDevice(data = {}, authState = {}) {
    const userUid = cleanText(authState.uid, 160);
    if (!userUid) throw new Error("A signed-in staff account is required.");
    const token = normalizePushToken(data.token);
    const bundleId = cleanText(data.bundleId, 200);
    if (!new Set(["com.chargerent.support", "com.chargerent.support.dev"]).has(bundleId)) {
      throw new Error("The support app identifier is invalid.");
    }
    const nowIso = clock().toISOString();
    const ref = db.collection(DEVICE_COLLECTION).doc(hashedDocumentId(userUid, token));
    await ref.set({
      userUid,
      token,
      bundleId,
      environment: cleanText(data.environment, 40),
      enabled: true,
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      createdAt: serverTimestamp(),
      createdAtIso: nowIso,
    }, {merge: true});
    return {ok: true};
  }

  async function supportNumberFor(ticketId, providedNumber) {
    const normalized = safeSupportNumber(providedNumber);
    if (normalized) return normalized;
    const id = cleanText(ticketId, 200);
    if (!id || id.includes("/")) return "";
    const snapshot = await db.collection("supportTickets").doc(id).get();
    if (!snapshot.exists) return "";
    return ticketCallSupportNumbers(snapshot.data() || {})[0] || "";
  }

  async function updateUnreadState(userUid, type, resourceId, markUnread) {
    const notificationId = hashedDocumentId(userUid, type, resourceId);
    const notificationRef = db.collection(NOTIFICATION_COLLECTION).doc(notificationId);
    const stateRef = db.collection(STATE_COLLECTION).doc(userUid);
    const nowIso = clock().toISOString();
    return db.runTransaction(async (transaction) => {
      const [notificationSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(notificationRef),
        transaction.get(stateRef),
      ]);
      const notification = notificationSnapshot.exists ? notificationSnapshot.data() || {} : {};
      const wasUnread = notification.unread === true;
      const currentCount = Math.max(0, Number(stateSnapshot.data()?.unreadCount) || 0);
      const changesState = markUnread ? !wasUnread : wasUnread;
      const unreadCount = changesState ? Math.max(0, currentCount + (markUnread ? 1 : -1)) : currentCount;
      transaction.set(notificationRef, {
        userUid,
        type,
        resourceId,
        unread: markUnread,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
        ...(!notificationSnapshot.exists ? {
          createdAt: serverTimestamp(),
          createdAtIso: nowIso,
        } : {}),
        ...(!markUnread ? {
          acknowledgedAt: serverTimestamp(),
          acknowledgedAtIso: nowIso,
        } : {}),
      }, {merge: true});
      transaction.set(stateRef, {
        userUid,
        unreadCount,
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso,
      }, {merge: true});
      return {changed: changesState, unreadCount, notificationId};
    });
  }

  async function enabledDevicesFor(userUids) {
    if (!userUids.length) return [];
    const users = new Set(userUids);
    const snapshot = await db.collection(DEVICE_COLLECTION).where("enabled", "==", true).get();
    return snapshot.docs.map((document) => ({
      id: document.id,
      ...(document.data() || {}),
    })).filter((device) => users.has(cleanText(device.userUid, 160)) && device.token);
  }

  async function sendToUserDevices(userUid, devices, event, unreadCount) {
    const userDevices = devices.filter((device) => device.userUid === userUid);
    if (!userDevices.length) return {sent: 0, failed: 0};
    const response = await admin.messaging().sendEachForMulticast({
      tokens: userDevices.map((device) => device.token),
      notification: {title: event.title, body: event.body},
      data: {
        notificationType: event.type,
        resourceId: event.resourceId,
        destination: event.destination,
        ticketId: event.ticketId,
      },
      apns: {
        headers: {"apns-priority": "10", "apns-push-type": "alert"},
        payload: {aps: {badge: unreadCount, sound: "default", category: "SUPPORT_ATTENTION"}},
      },
    });
    const invalidDeviceIds = [];
    response.responses.forEach((result, index) => {
      if (!result.success && isPermanentTokenError(result.error?.code)) {
        invalidDeviceIds.push(userDevices[index].id);
      }
    });
    await Promise.all(invalidDeviceIds.map((id) =>
      db.collection(DEVICE_COLLECTION).doc(id).set({
        enabled: false,
        disabledAt: serverTimestamp(),
        disabledAtIso: clock().toISOString(),
      }, {merge: true}),
    ));
    return {sent: response.successCount, failed: response.failureCount};
  }

  async function notify(data = {}) {
    const type = normalizeNotificationType(data.type);
    const resourceId = cleanText(data.resourceId, 200);
    const ticketId = cleanText(data.ticketId || resourceId, 200);
    if (!resourceId || resourceId.includes("/")) throw new Error("The notification resource is invalid.");
    const supportNumber = await supportNumberFor(ticketId, data.supportNumber);
    const staff = await listRoutingStaff();
    const recipients = eligibleNotificationRecipients(
        staff,
        supportNumber,
        safeSupportNumber(data.fallbackNumber),
    );
    const event = {
      type,
      resourceId,
      ticketId,
      destination: normalizeDestination(data.destination, type),
      title: cleanText(data.title, 120) || "Chargerent Support",
      body: cleanText(data.body, 300) || "New support activity is waiting.",
    };
    const states = await Promise.all(recipients.map(async (member) => ({
      userUid: member.userUid,
      ...(await updateUnreadState(member.userUid, type, resourceId, true)),
    })));
    const changedStates = states.filter((state) => state.changed);
    const devices = await enabledDevicesFor(changedStates.map((state) => state.userUid));
    const deliveries = await Promise.all(changedStates.map((state) =>
      sendToUserDevices(state.userUid, devices, event, state.unreadCount),
    ));
    return {
      ok: true,
      duplicate: states.length > 0 && changedStates.length === 0,
      recipients: recipients.length,
      sent: deliveries.reduce((total, result) => total + result.sent, 0),
      failed: deliveries.reduce((total, result) => total + result.failed, 0),
    };
  }

  async function acknowledge(data = {}, authState = {}) {
    const userUid = cleanText(authState.uid, 160);
    if (!userUid) throw new Error("A signed-in staff account is required.");
    const type = normalizeNotificationType(data.type);
    const resourceId = cleanText(data.resourceId, 200);
    if (!resourceId || resourceId.includes("/")) throw new Error("The notification resource is invalid.");
    const state = await updateUnreadState(userUid, type, resourceId, false);
    return {ok: true, unreadCount: state.unreadCount};
  }

  return {acknowledge, notify, registerDevice};
}

module.exports = {
  DEVICE_COLLECTION,
  NOTIFICATION_COLLECTION,
  STATE_COLLECTION,
  createSupportNotificationService,
  eligibleNotificationRecipients,
  hashedDocumentId,
  normalizeDestination,
  normalizeNotificationType,
  normalizePushToken,
};
