/* eslint-env node */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");

admin.initializeApp();
const db = admin.firestore();

const AUTH_MAPPING_DOMAIN = "auth.charge.rent";
// Must match the secret in Node-RED jwt verify nodes
const NODE_RED_JWT_SECRET = "Charger33";

async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const uid = request.auth.uid;
  const snap = await db.collection("users").doc(uid).get();

  if (!snap.exists) {
    throw new HttpsError("permission-denied", "No profile");
  }

  const profile = snap.data() || {};
  const isAdmin = profile.role === "admin" || profile.username === "chargerent";
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Not admin");
  }

  return { uid, profile };
}

function cleanProfile(input) {
  const clean = JSON.parse(JSON.stringify(input || {}));
  delete clean.password;
  delete clean.Password;
  delete clean.Email;
  delete clean.email;
  delete clean.token;
  return clean;
}

// Sync key profile fields into Firebase custom claims so Node-RED can read
// them directly from the verified ID token — no Firestore lookup needed.
async function syncCustomClaims(uid, profile) {
  await admin.auth().setCustomUserClaims(uid, {
    username: profile.username || "",
    clientId: profile.clientId || "",
    role: profile.role || "user",
    commands: profile.commands || {},
  });
}

function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}

function isValidUsername(u) {
  return /^[a-z0-9._-]+$/.test(u);
}

exports.admin_listUsers = onCall(async (request) => {
  await assertAdmin(request);

  const snap = await db.collection("users").get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  return { users };
});

exports.admin_deleteUser = onCall(async (request) => {
  await assertAdmin(request);

  const uid = String(request.data?.uid || "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "uid required");

  // Delete profile doc (does NOT delete Auth user yet)
  await db.collection("users").doc(uid).delete();
  return { ok: true };
});

exports.admin_upsertUserProfile = onCall(async (request) => {
  await assertAdmin(request);

  const uid = String(request.data?.uid || "").trim();
  const profile = request.data?.profile;

  if (!uid || !profile) {
    throw new HttpsError("invalid-argument", "uid and profile required");
  }

  const clean = cleanProfile(profile);
  clean.username = normalizeUsername(clean.username);
  clean.clientId = String(clean.clientId || "").trim().toUpperCase();
  clean.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  if (!clean.createdAt) clean.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("users").doc(uid).set(clean, { merge: true });
  await syncCustomClaims(uid, clean);
  return { ok: true };
});

exports.admin_createAuthUserAndProfile = onCall(async (request) => {
  await assertAdmin(request);

  const username = normalizeUsername(request.data?.username);
  const password = String(request.data?.password || "");
  const clientId = String(request.data?.clientId || "").trim().toUpperCase();
  const profileIn = request.data?.profile || {};
  const role = String(request.data?.profile?.role || "user");

  if (!username || !password) {
    throw new HttpsError("invalid-argument", "username and password required");
  }
  if (role !== "admin" && !clientId) {
    throw new HttpsError("invalid-argument", "clientId required for non-admin users");
  }
  if (!isValidUsername(username)) {
    throw new HttpsError("invalid-argument", "invalid username");
  }

  const email = `${username}@${AUTH_MAPPING_DOMAIN}`;

  // Create Auth user
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: username,
      disabled: false,
    });
  } catch (e) {
    if (e?.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "User already exists");
    }
    throw new HttpsError("internal", "Failed to create auth user");
  }

  const uid = userRecord.uid;

  // Create/merge Firestore profile at users/{uid}
  const clean = cleanProfile(profileIn);
  clean.username = username;
  clean.clientId = clientId;
  clean.authEmail = email;
  clean.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  clean.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await db.collection("users").doc(uid).set(clean, { merge: true });
  await syncCustomClaims(uid, clean);

  return { ok: true, uid, email };
});

exports.admin_setUserPassword = onCall(async (request) => {
  await assertAdmin(request);

  const uid = String(request.data?.uid || "").trim();
  const password = String(request.data?.password || "");

  if (!uid || !password) {
    throw new HttpsError("invalid-argument", "uid and password required");
  }

  await admin.auth().updateUser(uid, { password });
  return { ok: true };
});

// Tracks login attempts and manages lockout — callable without authentication
exports.auth_trackAttempt = onCall(async (request) => {
  const username = normalizeUsername(request.data?.username);
  const success = !!request.data?.success;

  if (!username || !isValidUsername(username)) {
    throw new HttpsError("invalid-argument", "valid username required");
  }

  const ref = db.collection("loginAttempts").doc(username);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};

  const now = new Date();
  const ip = request.rawRequest?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || request.rawRequest?.ip
    || null;
  const newLog = {
    timestamp: now.toISOString(),
    success,
    note: success ? "Login successful" : "Login failed",
    ...(ip ? { ip } : {}),
  };

  const logs = [...(existing.logs || []), newLog].slice(-50);

  let update;
  if (success) {
    update = { count: 0, lockedUntil: null, logs };
  } else {
    const newCount = (existing.count || 0) + 1;
    const lockedUntil = newCount >= 5
      ? new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
      : null;
    update = { count: newCount, lockedUntil, logs };
  }

  await ref.set(update, { merge: true });
  return { ok: true };
});

exports.admin_unlockUser = onCall(async (request) => {
  await assertAdmin(request);

  const username = normalizeUsername(request.data?.username);
  if (!username) throw new HttpsError("invalid-argument", "username required");

  const ref = db.collection("loginAttempts").doc(username);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : {};

  const unlockLog = {
    timestamp: new Date().toISOString(),
    success: true,
    note: "Account unlocked by admin",
  };

  const logs = [...(existing.logs || []), unlockLog].slice(-50);
  await ref.set({ count: 0, lockedUntil: null, logs }, { merge: true });
  return { ok: true };
});

// Exchange a Firebase ID token for a short-lived HS256 token that Node-RED can verify.
// Node-RED's jwt verify nodes use HS256 + secret "Charger33" — this bridges the two auth systems.
exports.issue_command_token = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Not signed in");
  }

  const uid = request.auth.uid;
  const snap = await db.collection("users").doc(uid).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "No user profile");
  }

  const profile = snap.data() || {};

  if (profile.active === false) {
    throw new HttpsError("permission-denied", "Account inactive");
  }

  // Build the same payload shape Node-RED's "Authorize Command" function expects
  const payload = {
    uid,
    username: profile.username || "",
    clientId: profile.clientId || "",
    role: profile.role || "user",
  };

  // Sign with HS256 using the same secret as Node-RED's jwt verify nodes
  // Short-lived: 90 minutes (Firebase ID tokens last 1 hour; this gives a small buffer)
  const commandToken = jwt.sign(payload, NODE_RED_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "90m",
  });

  return { commandToken };
});