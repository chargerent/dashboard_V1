/* eslint-env node */

const crypto = require("node:crypto");
const {
  appendCanadianPartnerSignatureCertificate,
  generateCanadianRegionalPartnerAgreement,
} = require("./canadianRegionalPartnerAgreementTemplate");

const INVITES_COLLECTION = "regionalPartnerOnboardingInvites";
const AGREEMENTS_COLLECTION = "regionalPartnerAgreements";
const CHALLENGES_COLLECTION = "regionalPartnerAgreementChallenges";
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function failure(code, message) {
  return Object.assign(new Error(message), {code, safe: true});
}

function text(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw failure("invalid-argument", "Enter a valid contact email address.");
  }
  return normalized;
}

function normalizeUsername(value) {
  const normalized = text(value, 64).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(normalized)) {
    throw failure(
        "invalid-argument",
        "The dashboard username can contain letters, numbers, periods, underscores, and hyphens.",
    );
  }
  return normalized;
}

function normalizeClientId(value) {
  const normalized = text(value, 24).toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(normalized)) {
    throw failure(
        "invalid-argument",
        "The partner ID must contain 2-24 letters, numbers, underscores, or hyphens.",
    );
  }
  return normalized;
}

function normalizePartnerType(value) {
  const normalized = text(value || "company", 20).toLowerCase();
  if (!["company", "individual"].includes(normalized)) {
    throw failure("invalid-argument", "Select Company or Individual as the partner type.");
  }
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tokenHash(value) {
  const token = text(value, 200);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw failure("permission-denied", "This onboarding link is invalid.");
  }
  return sha256(token);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampIso(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : "";
}

function otpHash(secret, inviteId, code) {
  return crypto.createHmac("sha256", secret)
      .update(`${inviteId}:${code}`)
      .digest("hex");
}

function hashesMatch(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeCreateInput(input = {}) {
  const countryCode = text(input.countryCode || "CA", 2).toUpperCase();
  if (countryCode !== "CA") {
    throw failure(
        "invalid-argument",
        "This onboarding flow currently supports Canadian regional partners only.",
    );
  }
  const province = text(input.province, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(province)) {
    throw failure("invalid-argument", "Select the partner's Canadian province or territory.");
  }
  if (province === "QC") {
    throw failure(
        "failed-precondition",
        "Quebec invitations are paused until the approved French agreement is available.",
    );
  }
  const territory = text(input.territory, 240);
  const contactName = text(input.contactName, 160);
  if (!territory || !contactName) {
    throw failure("invalid-argument", "Contact name and Canadian territory are required.");
  }
  return {
    partnerType: normalizePartnerType(input.partnerType),
    contactName,
    contactEmail: email(input.contactEmail),
    username: normalizeUsername(input.username),
    clientId: normalizeClientId(input.clientId),
    countryCode,
    province,
    territory,
    language: "en",
  };
}

function normalizeProfileInput(input = {}, invite = {}) {
  const partnerType = normalizePartnerType(invite.partnerType);
  const legalName = text(input.legalName, 180);
  const businessAddress = text(input.businessAddress, 300);
  const city = text(input.city, 120);
  const postalCode = text(input.postalCode, 20).toUpperCase();
  const telephone = text(input.telephone, 80);
  const signerName = partnerType === "individual" ?
    legalName : text(input.signerName, 160);
  const signerTitle = partnerType === "individual" ?
    "Individual" : text(input.signerTitle, 120);
  const taxNumber = text(input.taxNumber, 80);
  if (!legalName || !businessAddress || !city || !postalCode || !telephone ||
      !signerName || !signerTitle) {
    throw failure(
        "invalid-argument",
        partnerType === "individual" ?
          "Complete your legal name, address, and phone fields." :
          "Complete the legal company, address, phone, and authorized-signer fields.",
    );
  }
  return {
    partnerType,
    legalName,
    businessAddress,
    city,
    province: text(invite.province, 2).toUpperCase(),
    postalCode,
    countryCode: "CA",
    telephone,
    signerName,
    signerTitle,
    taxNumber,
  };
}

function maskEmail(value) {
  const [local, domain] = String(value || "").split("@");
  if (!local || !domain) return "the email on file";
  return `${local.slice(0, Math.min(2, local.length))}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
}

function isReadyForActivation(invite = {}) {
  return invite.agreementStatus === "signed";
}

function createRegionalPartnerOnboarding({
  db,
  admin,
  bucket,
  sendEmail,
  getOtpSecret,
  dashboardBaseUrl = "https://chargerentstations.com/portal/",
  now = () => new Date(),
  generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0"),
  generateToken = () => crypto.randomBytes(32).toString("hex"),
  isAgreementApproved = () =>
    String(process.env.CANADIAN_PARTNER_AGREEMENT_APPROVED || "") === "true",
  signPdf = appendCanadianPartnerSignatureCertificate,
  logger = console,
}) {
  if (!db || !admin || !bucket || typeof sendEmail !== "function" ||
      typeof getOtpSecret !== "function") {
    throw new TypeError("Regional partner onboarding dependencies are required.");
  }

  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function loadInvite(rawToken, {allowExpired = false} = {}) {
    const id = tokenHash(rawToken);
    const ref = db.collection(INVITES_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw failure("permission-denied", "This onboarding link is invalid.");
    }
    const invite = snapshot.data() || {};
    if (!allowExpired && timestampMillis(invite.expiresAt) < now().getTime()) {
      throw failure(
          "failed-precondition",
          "This onboarding link has expired. Ask Chargerent for a new invitation.",
      );
    }
    if (invite.revokedAt) {
      throw failure("permission-denied", "This onboarding link has been revoked.");
    }
    return {id, ref, invite};
  }

  async function loadUser(uid) {
    const ref = db.collection("users").doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw failure("not-found", "The partner profile was not found.");
    return {ref, profile: snapshot.data() || {}};
  }

  async function agreementForInvite(invite) {
    const agreementId = text(invite.agreementId, 160);
    if (!agreementId) return null;
    const ref = db.collection(AGREEMENTS_COLLECTION).doc(agreementId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    return {id: agreementId, ref, agreement: snapshot.data() || {}};
  }

  async function agreementUrl(record) {
    if (!record) return "";
    const agreement = record.agreement;
    const storagePath = agreement.status === "signed" ?
      agreement.signedStoragePath : agreement.sourceStoragePath;
    if (!storagePath) return "";
    const [url] = await bucket.file(storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + (15 * 60 * 1000),
      responseDisposition: "inline",
      responseType: "application/pdf",
    });
    return url;
  }

  async function serializePublic(inviteRecord) {
    const {invite} = inviteRecord;
    const agreement = await agreementForInvite(invite);
    return {
      status: text(invite.status, 40) || "invited",
      contactName: text(invite.contactName, 160),
      contactEmailMasked: maskEmail(invite.contactEmail),
      clientId: text(invite.clientId, 24),
      partnerType: normalizePartnerType(invite.partnerType),
      countryCode: "CA",
      province: text(invite.province, 2),
      territory: text(invite.territory, 240),
      contractingEntity: "Chargerent Inc",
      currency: "CAD",
      commissionPoolPercent: 40,
      testMode: invite.testMode === true,
      expiresAt: timestampIso(invite.expiresAt),
      profile: invite.profile || {},
      agreement: agreement ? {
        id: agreement.id,
        title: text(agreement.agreement.title, 180),
        version: text(agreement.agreement.version, 80),
        status: text(agreement.agreement.status, 40),
        agreementUrl: await agreementUrl(agreement),
        urlExpiresInSeconds: 15 * 60,
        signedAt: timestampIso(agreement.agreement.signedAt),
      } : {status: "not_prepared"},
      activation: invite.activation || {status: "not_ready"},
    };
  }

  async function ensureUnique(values) {
    const [usernameSnapshot, clientIdSnapshot] = await Promise.all([
      db.collection("users").where("username", "==", values.username).limit(1).get(),
      db.collection("users").where("clientId", "==", values.clientId).limit(1).get(),
    ]);
    if (!usernameSnapshot.empty) {
      throw failure("already-exists", "That dashboard username is already in use.");
    }
    if (!clientIdSnapshot.empty) {
      throw failure("already-exists", "That partner ID is already in use.");
    }
  }

  function inviteLink(rawToken) {
    const url = new URL(dashboardBaseUrl);
    url.searchParams.set("partnerInvite", rawToken);
    return url.toString();
  }

  async function createInvite({authState, input}) {
    if (authState?.isAdmin !== true) {
      throw failure("permission-denied", "Only an administrator can invite a partner.");
    }
    const values = normalizeCreateInput(input);
    const testMode = input?.testMode === true;
    if (!testMode && !isAgreementApproved()) {
      throw failure(
          "failed-precondition",
          "Production invitations are locked until the Canadian agreement has legal approval.",
      );
    }
    await ensureUnique(values);
    const rawToken = generateToken();
    const id = tokenHash(rawToken);
    const ref = db.collection(INVITES_COLLECTION).doc(id);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + INVITE_TTL_MS);
    const authEmail = `${values.username}@auth.charge.rent`;
    let authUser;
    try {
      authUser = await admin.auth().createUser({
        email: authEmail,
        displayName: values.username,
        disabled: true,
        password: `Cr-${crypto.randomBytes(24).toString("base64url")}!`,
      });
      const profile = {
        username: values.username,
        authEmail,
        clientId: values.clientId,
        role: "partner",
        partner: true,
        active: false,
        contact: {name: values.contactName, email: values.contactEmail, phone: ""},
        commission: "40",
        paymentSchedule: "monthly",
        paymentAdmin: "george",
        countryCode: "CA",
        partnerType: values.partnerType,
        contractingEntity: "Chargerent Inc",
        currency: "CAD",
        regionalPartner: {
          partnerType: values.partnerType,
          countryCode: "CA",
          province: values.province,
          territory: values.territory,
          language: values.language,
          contractingEntity: "Chargerent Inc",
          currency: "CAD",
          commissionPoolPercent: 40,
          onboarding: {
            status: "invited",
            inviteId: id,
            testMode,
            profileStatus: "not_started",
            agreementStatus: "not_prepared",
            activationStatus: "not_ready",
            createdAt,
          },
        },
        features: {
          rentals: true,
          stationid: true,
          address: true,
          status: true,
          reporting: true,
          rental_counts: true,
          rental_revenue: true,
          rep_commission: true,
          defaultlanguage: "en",
        },
        commands: {},
        createdAt,
        updatedAt: createdAt,
      };
      const invite = {
        uid: authUser.uid,
        authEmail,
        ...values,
        status: "invited",
        contractingEntity: "Chargerent Inc",
        currency: "CAD",
        commissionPoolPercent: 40,
        testMode,
        agreementStatus: "not_prepared",
        activation: {status: "not_ready"},
        createdAt,
        createdBy: text(authState.uid, 160),
        expiresAt,
        notificationStatus: "pending",
      };
      const batch = db.batch();
      batch.set(db.collection("users").doc(authUser.uid), profile);
      batch.set(ref, invite);
      await batch.commit();
      await admin.auth().setCustomUserClaims(authUser.uid, {
        username: values.username,
        clientId: values.clientId,
        role: "partner",
        commands: {},
      });
    } catch (error) {
      if (authUser?.uid) await admin.auth().deleteUser(authUser.uid).catch(() => {});
      if (error?.safe) throw error;
      if (error?.code === "auth/email-already-exists") {
        throw failure("already-exists", "That dashboard username is already in use.");
      }
      logger.error("Regional partner invite creation failed", {
        code: text(error?.code, 80) || "unknown",
      });
      throw failure("unavailable", "The partner invitation could not be created.");
    }

    let notificationStatus = "sent";
    try {
      await sendEmail({
        to: values.contactEmail,
        fromName: "Chargerent",
        subject: `${testMode ? "[TEST] " : ""}Complete your Chargerent regional partner onboarding`,
        body: [
          `Hi ${values.contactName},`,
          "",
          ...(testMode ? [
            "This is a test onboarding invitation for internal workflow testing. It does not activate a production partner account.",
            "",
          ] : []),
          `Chargerent Inc has invited you to onboard as the regional partner for ${values.territory}.`,
          "",
          "Use the secure link below to provide your company or individual information and review and sign the Canadian regional representative agreement:",
          inviteLink(rawToken),
          "",
          "The invitation expires in 30 days. Dashboard access is issued after the agreement is signed and approved by a Chargerent administrator.",
          "",
          "Chargerent",
        ].join("\n"),
      });
    } catch (error) {
      notificationStatus = "unknown";
      logger.error("Regional partner invitation email failed", {
        inviteId: id,
        code: text(error?.code, 80) || "unknown",
      });
    }
    await ref.set({
      notificationStatus,
      notificationUpdatedAt: serverTimestamp(),
    }, {merge: true});
    return {
      ok: true,
      id,
      uid: authUser.uid,
      inviteUrl: inviteLink(rawToken),
      notificationStatus,
    };
  }

  async function listInvites({authState}) {
    if (authState?.isAdmin !== true) {
      throw failure("permission-denied", "Only an administrator can view partner onboarding.");
    }
    const snapshot = await db.collection(INVITES_COLLECTION).get();
    const invitations = snapshot.docs.map((doc) => {
      const value = doc.data() || {};
      return {
        id: doc.id,
        uid: text(value.uid, 160),
        contactName: text(value.contactName, 160),
        contactEmail: text(value.contactEmail, 254),
        clientId: text(value.clientId, 24),
        partnerType: normalizePartnerType(value.partnerType),
        province: text(value.province, 2),
        territory: text(value.territory, 240),
        status: text(value.status, 40),
        agreementStatus: text(value.agreementStatus, 40),
        activation: value.activation || {status: "not_ready"},
        notificationStatus: text(value.notificationStatus, 40),
        testMode: value.testMode === true,
        createdAt: timestampIso(value.createdAt),
        expiresAt: timestampIso(value.expiresAt),
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {invitations};
  }

  async function getStatus({token}) {
    return serializePublic(await loadInvite(token));
  }

  async function submitProfile({token, input}) {
    const record = await loadInvite(token);
    if (["awaiting_signature", "signed"].includes(record.invite.agreementStatus)) {
      return serializePublic(record);
    }
    const profileInput = normalizeProfileInput(input, record.invite);
    const user = await loadUser(record.invite.uid);
    const effectiveDate = now().toISOString().slice(0, 10);
    const generated = await generateCanadianRegionalPartnerAgreement({
      partnerType: profileInput.partnerType,
      legalName: profileInput.legalName,
      businessAddress: `${profileInput.businessAddress}, ${profileInput.city}, ${profileInput.province} ${profileInput.postalCode}, Canada`,
      telephone: profileInput.telephone,
      email: record.invite.contactEmail,
      taxNumber: profileInput.taxNumber,
      effectiveDate,
      territory: record.invite.territory,
    });
    const agreementRef = db.collection(AGREEMENTS_COLLECTION).doc();
    const sourceHash = sha256(generated.buffer);
    const storagePath = `regional-partners/agreements/${record.invite.uid}/${agreementRef.id}/source.pdf`;
    await bucket.file(storagePath).save(generated.buffer, {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
        metadata: {agreementId: agreementRef.id, inviteId: record.id, sourceHash},
      },
      preconditionOpts: {ifGenerationMatch: 0},
    });
    const agreement = {
      inviteId: record.id,
      partnerUid: record.invite.uid,
      clientId: record.invite.clientId,
      partnerType: profileInput.partnerType,
      title: "Chargerent Inc Canadian Regional Representative Agreement",
      testMode: record.invite.testMode === true,
      version: generated.version,
      templateId: generated.templateId,
      templateDetails: generated.details,
      status: "awaiting_signature",
      sourceStoragePath: storagePath,
      sourceHash,
      sourceSize: generated.buffer.length,
      preparedAt: now(),
    };
    const batch = db.batch();
    batch.set(agreementRef, agreement);
    batch.set(record.ref, {
      profile: profileInput,
      agreementId: agreementRef.id,
      agreementStatus: "awaiting_signature",
      status: "awaiting_signature",
      profileSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    batch.set(user.ref, {
      contact: {
        ...(user.profile.contact || {}),
        name: profileInput.signerName,
        phone: profileInput.telephone,
      },
      legalBusinessName: profileInput.legalName,
      partnerType: profileInput.partnerType,
      regionalPartner: {
        ...(user.profile.regionalPartner || {}),
        partnerType: profileInput.partnerType,
        profile: profileInput,
        onboarding: {
          ...(user.profile.regionalPartner?.onboarding || {}),
          status: "awaiting_signature",
          profileStatus: "complete",
          agreementStatus: "awaiting_signature",
          agreementId: agreementRef.id,
          updatedAt: serverTimestamp(),
        },
      },
      updatedAt: serverTimestamp(),
    }, {merge: true});
    await batch.commit();
    try {
      await sendEmail({
        to: record.invite.contactEmail,
        fromName: "Chargerent",
        subject: `${record.invite.testMode === true ? "[TEST] " : ""}Your Canadian regional partner agreement is ready`,
        body: [
          `Hi ${record.invite.contactName},`,
          "",
          `Your ${profileInput.partnerType === "individual" ? "individual" : "company"} profile was saved and your Canadian Regional Representative Agreement is ready to review and sign.`,
          "",
          "Continue securely here:",
          inviteLink(token),
          "",
          "Chargerent",
        ].join("\n"),
      });
    } catch (error) {
      logger.error("Regional partner agreement-ready email failed", {
        inviteId: record.id,
        code: text(error?.code, 80) || "unknown",
      });
    }
    return serializePublic({...record, invite: {
      ...record.invite,
      profile: profileInput,
      agreementId: agreementRef.id,
      agreementStatus: "awaiting_signature",
      status: "awaiting_signature",
    }});
  }

  async function requestAgreementCode({token}) {
    const record = await loadInvite(token);
    const agreementRecord = await agreementForInvite(record.invite);
    if (!agreementRecord || agreementRecord.agreement.status !== "awaiting_signature") {
      throw failure("failed-precondition", "There is no agreement ready to sign.");
    }
    const secret = text(getOtpSecret(), 500);
    if (secret.length < 32) {
      throw failure("failed-precondition", "Agreement verification is not configured.");
    }
    const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(record.id);
    const existing = await challengeRef.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    if (timestampMillis(existingData.sentAt) + OTP_RESEND_MS > now().getTime()) {
      throw failure("resource-exhausted", "Wait one minute before requesting another code.");
    }
    const code = generateCode();
    const sentAt = now();
    await challengeRef.set({
      inviteId: record.id,
      agreementId: agreementRecord.id,
      codeHash: otpHash(secret, record.id, code),
      attempts: 0,
      sentAt,
      expiresAt: new Date(sentAt.getTime() + OTP_TTL_MS),
      usedAt: null,
    });
    try {
      await sendEmail({
        to: record.invite.contactEmail,
        fromName: "Chargerent",
        subject: "Your Chargerent agreement verification code",
        body: [
          `Your verification code is: ${code}`,
          "",
          "Use this code to sign the Canadian Regional Representative Agreement.",
          "The code expires in 10 minutes and can be used only once.",
          "",
          "Chargerent",
        ].join("\n"),
      });
    } catch {
      await challengeRef.delete();
      throw failure("unavailable", "The verification email could not be sent.");
    }
    return {ok: true, emailMasked: maskEmail(record.invite.contactEmail)};
  }

  async function signAgreement({token, input, evidence = {}}) {
    const record = await loadInvite(token);
    const agreementRecord = await agreementForInvite(record.invite);
    if (!agreementRecord || agreementRecord.agreement.status !== "awaiting_signature") {
      throw failure("failed-precondition", "There is no agreement ready to sign.");
    }
    const partnerType = normalizePartnerType(record.invite.partnerType);
    const signerName = text(input?.signerName, 160);
    const signerTitle = partnerType === "individual" ?
      "Individual" : text(input?.signerTitle, 120);
    const code = text(input?.code, 12);
    if (!signerName || !signerTitle || !/^\d{6}$/.test(code) ||
        input?.reviewedDocument !== true || input?.consentElectronic !== true ||
        input?.intentToSign !== true) {
      throw failure(
          "invalid-argument",
          "Complete the signer details, verification code, and signature confirmations.",
      );
    }
    if (partnerType === "individual" &&
        signerName.toLocaleLowerCase() !==
          text(record.invite.profile?.legalName, 160).toLocaleLowerCase()) {
      throw failure(
          "invalid-argument",
          "The signer name must match the individual's legal name in the agreement.",
      );
    }
    const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(record.id);
    const challengeSnapshot = await challengeRef.get();
    const challenge = challengeSnapshot.exists ? challengeSnapshot.data() || {} : {};
    const attempts = Number(challenge.attempts || 0);
    const secret = text(getOtpSecret(), 500);
    const valid = challenge.agreementId === agreementRecord.id && !challenge.usedAt &&
      attempts < MAX_OTP_ATTEMPTS && timestampMillis(challenge.expiresAt) >= now().getTime() &&
      hashesMatch(challenge.codeHash, otpHash(secret, record.id, code));
    if (!valid) {
      await challengeRef.set({attempts: attempts + 1, lastAttemptAt: serverTimestamp()}, {merge: true});
      throw failure("invalid-argument", "The verification code is invalid or expired.");
    }
    const [sourcePdf] = await bucket.file(agreementRecord.agreement.sourceStoragePath).download();
    if (sha256(sourcePdf) !== agreementRecord.agreement.sourceHash) {
      throw failure("failed-precondition", "The agreement source could not be verified.");
    }
    const signedAt = now();
    const signedPdf = await signPdf(sourcePdf, {
      title: agreementRecord.agreement.title,
      version: agreementRecord.agreement.version,
      agreementId: agreementRecord.id,
      clientId: record.invite.clientId,
      venueName: record.invite.territory,
      signerName,
      signerTitle,
      signerEmail: record.invite.contactEmail,
      partnerType,
      signedAt: signedAt.toISOString(),
      sourceHash: agreementRecord.agreement.sourceHash,
    });
    const signedStoragePath = `regional-partners/agreements/${record.invite.uid}/${agreementRecord.id}/signed.pdf`;
    const signedHash = sha256(signedPdf);
    await bucket.file(signedStoragePath).save(signedPdf, {
      resumable: false,
      metadata: {contentType: "application/pdf", cacheControl: "private, no-store"},
      preconditionOpts: {ifGenerationMatch: 0},
    });
    const user = await loadUser(record.invite.uid);
    const batch = db.batch();
    batch.set(agreementRecord.ref, {
      status: "signed",
      signedAt,
      signedStoragePath,
      signedHash,
      signedSize: signedPdf.length,
      signer: {
        partnerType,
        name: signerName,
        title: signerTitle,
        email: record.invite.contactEmail,
        authMethod: "invite_token_email_otp",
        ipAddress: text(evidence.ipAddress, 120),
        userAgent: text(evidence.userAgent, 500),
      },
      consent: {electronicRecords: true, reviewedDocument: true, intentToSign: true},
    }, {merge: true});
    batch.set(challengeRef, {usedAt: serverTimestamp()}, {merge: true});
    batch.set(record.ref, {
      agreementStatus: "signed",
      status: "ready_for_approval",
      signedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
    batch.set(user.ref, {
      regionalPartner: {
        ...(user.profile.regionalPartner || {}),
        onboarding: {
          ...(user.profile.regionalPartner?.onboarding || {}),
          status: "ready_for_approval",
          agreementStatus: "signed",
          signedAt: serverTimestamp(),
        },
      },
      updatedAt: serverTimestamp(),
    }, {merge: true});
    await batch.commit();
    try {
      await sendEmail({
        to: record.invite.contactEmail,
        fromName: "Chargerent",
        subject: `${record.invite.testMode === true ? "[TEST] " : ""}Your signed Chargerent regional partner agreement`,
        body: [
          `Hi ${record.invite.contactName},`,
          "",
          "Your electronic signature has been recorded. A Chargerent administrator will now review your onboarding and activate your dashboard access.",
          "",
          "Chargerent",
        ].join("\n"),
        attachments: [{
          filename: `${record.invite.clientId}-Canadian-Regional-Partner-Signed.pdf`,
          content: signedPdf,
          contentType: "application/pdf",
        }],
      });
    } catch (error) {
      logger.error("Regional partner signed agreement email failed", {
        inviteId: record.id,
        code: text(error?.code, 80) || "unknown",
      });
    }
    return serializePublic({...record, invite: {
      ...record.invite,
      agreementStatus: "signed",
      status: "ready_for_approval",
    }});
  }

  async function activate({authState, inviteId}) {
    if (authState?.isAdmin !== true) {
      throw failure("permission-denied", "Only an administrator can activate a partner.");
    }
    const id = text(inviteId, 160);
    const ref = db.collection(INVITES_COLLECTION).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw failure("not-found", "The partner invitation was not found.");
    const invite = snapshot.data() || {};
    if (!isReadyForActivation(invite)) {
      throw failure(
          "failed-precondition",
          "The signed agreement is required before activation.",
      );
    }
    const user = await loadUser(invite.uid);
    await admin.auth().updateUser(invite.uid, {disabled: false});
    const resetUrl = await admin.auth().generatePasswordResetLink(invite.authEmail, {
      url: dashboardBaseUrl,
      handleCodeInApp: false,
    });
    const activatedAt = now();
    const batch = db.batch();
    batch.set(ref, {
      status: "activated",
      activation: {
        status: "active",
        activatedAt,
        activatedBy: text(authState.uid, 160),
        emailStatus: "pending",
      },
      updatedAt: serverTimestamp(),
    }, {merge: true});
    batch.set(user.ref, {
      active: true,
      regionalPartner: {
        ...(user.profile.regionalPartner || {}),
        onboarding: {
          ...(user.profile.regionalPartner?.onboarding || {}),
          status: "activated",
          activationStatus: "active",
          activatedAt,
        },
      },
      updatedAt: serverTimestamp(),
    }, {merge: true});
    await batch.commit();
    let emailStatus = "sent";
    try {
      await sendEmail({
        to: invite.contactEmail,
        fromName: "Chargerent",
        subject: `${invite.testMode === true ? "[TEST] " : ""}Your Chargerent regional partner dashboard is ready`,
        body: [
          `Hi ${invite.contactName},`,
          "",
          "Your Canadian regional partner onboarding has been approved and your Chargerent dashboard account is ready.",
          `Username: ${invite.username}`,
          "",
          "Set your password securely using this one-time link:",
          resetUrl,
          "",
          `Dashboard: ${dashboardBaseUrl}`,
          "",
          "Chargerent",
        ].join("\n"),
      });
    } catch {
      emailStatus = "unknown";
      logger.error("Regional partner activation email failed", {inviteId: id});
    }
    await ref.update({
      "activation.emailStatus": emailStatus,
      "activation.emailUpdatedAt": serverTimestamp(),
    });
    return {ok: true, status: "activated", emailStatus};
  }

  return {
    activate,
    createInvite,
    getStatus,
    listInvites,
    loadInvite,
    requestAgreementCode,
    signAgreement,
    submitProfile,
  };
}

module.exports = {
  AGREEMENTS_COLLECTION,
  CHALLENGES_COLLECTION,
  INVITES_COLLECTION,
  createRegionalPartnerOnboarding,
  isReadyForActivation,
  maskEmail,
  normalizeCreateInput,
  normalizePartnerType,
  normalizeProfileInput,
  tokenHash,
};
