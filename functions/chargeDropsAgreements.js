/* eslint-env node */

const crypto = require("node:crypto");
const {PDFDocument, StandardFonts, rgb} = require("pdf-lib");
const {
  generateChargeRentClientAgreement,
} = require("./chargeRentClientAgreementTemplate");

const AGREEMENTS_COLLECTION = "chargeDropsAgreements";
const CHALLENGES_COLLECTION = "chargeDropsAgreementChallenges";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function failure(code, message) {
  return Object.assign(new Error(message), {code, safe: true});
}

function text(value, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isChargeDropsClient(profile) {
  return profile?.product === "chargedrops" ||
    profile?.portalBrand === "chargedrops" ||
    profile?.products?.chargedrops === true;
}

function emailForProfile(profile) {
  const email = text(profile?.contact?.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw failure(
        "failed-precondition",
        "The ChargeDrops profile needs a valid contact email.",
    );
  }
  return email;
}

function maskEmail(value) {
  const [local, domain] = String(value || "").split("@");
  if (!local || !domain) return "the email on file";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

function safeFileName(value) {
  return text(value || "agreement.pdf", 180)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "agreement.pdf";
}

function otpHash(secret, agreementId, uid, code) {
  return crypto.createHmac("sha256", secret)
      .update(`${agreementId}:${uid}:${code}`)
      .digest("hex");
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  return leftBuffer.length > 0 && leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateOtpSecret(value) {
  const secret = text(value, 500);
  if (secret.length < 32) {
    throw failure(
        "failed-precondition",
        "ChargeDrops agreement verification is not configured.",
    );
  }
  return secret;
}

function normalizeRequestEvidence(value = {}) {
  return {
    ipAddress: text(value.ipAddress, 120),
    userAgent: text(value.userAgent, 500),
  };
}

function splitLines(font, value, size, maxWidth) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

async function appendSignatureCertificate(sourcePdf, certificate) {
  const pdf = await PDFDocument.load(sourcePdf, {ignoreEncryption: false});
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  const dark = rgb(0.06, 0.09, 0.16);
  const indigo = rgb(0.25, 0.29, 0.82);
  const gray = rgb(0.34, 0.4, 0.49);
  let y = 728;

  page.drawText("ChargeDrops", {x: 48, y, size: 24, font: bold, color: indigo});
  y -= 38;
  page.drawText("Certificate of Electronic Signature", {
    x: 48, y, size: 18, font: bold, color: dark,
  });
  y -= 24;
  page.drawText(
      "This page is attached to and forms part of the agreement identified below.",
      {x: 48, y, size: 10, font: regular, color: gray},
  );
  y -= 38;

  const rows = [
    ["Agreement", certificate.title],
    ["Version", certificate.version],
    ["Agreement ID", certificate.agreementId],
    ["Client", certificate.clientId],
    ["Venue", certificate.venueName],
    ["Signer", certificate.signerName],
    ["Signer title", certificate.signerTitle],
    ["Signer email", certificate.signerEmail],
    ["Signed at", certificate.signedAt],
    ["Authentication", "ChargeDrops portal login plus emailed one-time code"],
    ["Source document SHA-256", certificate.sourceHash],
  ];

  for (const [label, value] of rows) {
    page.drawText(label, {x: 48, y, size: 9, font: bold, color: gray});
    const lines = splitLines(regular, value || "Not provided", 10, 345);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 190,
        y: y - (index * 13),
        size: 10,
        font: regular,
        color: dark,
      });
    });
    y -= Math.max(27, (lines.length * 13) + 8);
  }

  y -= 12;
  page.drawLine({
    start: {x: 48, y},
    end: {x: 420, y},
    thickness: 1,
    color: dark,
  });
  y -= 24;
  page.drawText(`/s/ ${certificate.signerName}`, {
    x: 48, y, size: 18, font: bold, color: dark,
  });
  y -= 18;
  page.drawText("Electronic signature", {
    x: 48, y, size: 9, font: regular, color: gray,
  });
  y -= 36;

  const statement =
    "The signer consented to receive and sign this agreement electronically, " +
    "confirmed that the complete agreement was reviewed, and adopted the " +
    "electronic signature above with the intent to be legally bound.";
  splitLines(regular, statement, 10, 510).forEach((line, index) => {
    page.drawText(line, {
      x: 48,
      y: y - (index * 14),
      size: 10,
      font: regular,
      color: dark,
    });
  });

  return Buffer.from(await pdf.save({useObjectStreams: false}));
}

function createChargeDropsAgreementService({
  db,
  admin,
  bucket,
  getOtpSecret,
  sendEmail,
  dashboardBaseUrl = "https://chargerentstations.com/portal/",
  adminCopyEmail = () => "",
  now = () => new Date(),
  generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0"),
  signPdf = appendSignatureCertificate,
  notifyPartner = async () => ({status: "skipped"}),
  logger = console,
}) {
  if (!db || !admin || !bucket || typeof getOtpSecret !== "function" ||
      typeof sendEmail !== "function") {
    throw new TypeError("ChargeDrops agreement dependencies are required.");
  }

  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function notifyPartnerSafely(target, eventType, eventKey, actorUid) {
    try {
      return await notifyPartner({
        clientUid: target.uid,
        clientProfile: target.profile,
        eventType,
        eventKey,
        actorUid,
      });
    } catch (error) {
      logger.error("ChargeDrops agreement partner update failed", {
        clientUid: target.uid,
        eventType,
        code: text(error?.code, 80) || "unknown",
      });
      return {status: "unknown"};
    }
  }

  async function loadTarget(authState, requestedUid = "", adminOnly = false) {
    const actorUid = text(authState?.uid, 160);
    const uid = text(requestedUid, 160) || actorUid;
    if (!actorUid) throw failure("unauthenticated", "Sign in to continue.");
    if (adminOnly && authState?.isAdmin !== true) {
      throw failure("permission-denied", "Only an administrator can prepare agreements.");
    }
    if (uid !== actorUid && authState?.isAdmin !== true) {
      throw failure("permission-denied", "You cannot access another client's agreement.");
    }
    const ref = db.collection("users").doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw failure("not-found", "The ChargeDrops client profile was not found.");
    }
    const profile = snapshot.data() || {};
    if (!isChargeDropsClient(profile)) {
      throw failure("failed-precondition", "This account is not a ChargeDrops client.");
    }
    return {uid, ref, profile};
  }

  async function currentAgreement(target) {
    const agreementId = text(target.profile?.chargedrops?.agreement?.id, 160);
    if (!agreementId) return null;
    const ref = db.collection(AGREEMENTS_COLLECTION).doc(agreementId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const agreement = snapshot.data() || {};
    if (text(agreement.clientUid, 160) !== target.uid) {
      throw failure("permission-denied", "The agreement does not belong to this client.");
    }
    return {id: agreementId, ref, agreement};
  }

  async function addEvent(agreementRef, type, actor, details = {}) {
    await agreementRef.collection("events").doc().set({
      type,
      actorUid: text(actor?.uid, 160),
      actorRole: actor?.isAdmin === true ? "admin" : "client",
      occurredAt: serverTimestamp(),
      ...details,
    });
  }

  async function updateProfileAgreement(target, agreement, status) {
    const timestamp = serverTimestamp();
    const chargedrops = {
      ...(target.profile.chargedrops || {}),
      agreement: {
        id: agreement.id,
        title: agreement.title,
        version: agreement.version,
        status,
        preparedAt: agreement.preparedAt || timestamp,
        ...(agreement.signedAt ? {signedAt: agreement.signedAt} : {}),
      },
      onboarding: {
        ...(target.profile?.chargedrops?.onboarding || {}),
        agreementStatus: status,
        agreementUpdatedAt: timestamp,
      },
    };
    await target.ref.set({chargedrops, updatedAt: timestamp}, {merge: true});
    target.profile = {...target.profile, chargedrops};
  }

  async function agreementReadUrl(agreement) {
    const storagePath = agreement.status === "signed" && agreement.signedStoragePath ?
      agreement.signedStoragePath : agreement.sourceStoragePath;
    if (!storagePath) return "";
    const fileName = agreement.status === "signed" ?
      `signed-${safeFileName(agreement.fileName)}` : safeFileName(agreement.fileName);
    const [url] = await bucket.file(storagePath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + (15 * 60 * 1000),
      responseDisposition: `inline; filename="${fileName.replace(/["\\]/g, "_")}"`,
      responseType: "application/pdf",
    });
    return url;
  }

  async function serializeAgreement(record) {
    if (!record) {
      return {status: "not_prepared", canSign: false};
    }
    const {id, agreement} = record;
    return {
      id,
      title: agreement.title,
      version: agreement.version,
      fileName: agreement.fileName,
      status: agreement.status,
      canSign: agreement.status === "awaiting_signature",
      preparedAt: timestampIso(agreement.preparedAt),
      signedAt: timestampIso(agreement.signedAt),
      signerName: text(agreement.signer?.name, 160),
      signerTitle: text(agreement.signer?.title, 120),
      sourceHash: text(agreement.sourceHash, 64),
      notificationStatus: text(agreement.notificationStatus, 40),
      completionEmailStatus: text(agreement.completionEmailStatus, 40),
      agreementUrl: await agreementReadUrl(agreement),
      urlExpiresInSeconds: 15 * 60,
    };
  }

  async function sendPreparedEmail(target, agreement) {
    const venue = text(target.profile?.chargedrops?.location?.venueName, 160) ||
      text(target.profile?.clientId, 80) || "your location";
    const name = text(target.profile?.contact?.name, 160) || "there";
    const email = emailForProfile(target.profile);
    const body = [
      `Hi ${name},`,
      "",
      `Your ${agreement.title} is ready in the ChargeDrops Client Portal.`,
      `Agreement version: ${agreement.version}`,
      `Location: ${venue}`,
      "",
      "Sign in to review the complete PDF and sign it securely:",
      dashboardBaseUrl,
      "",
      "After the agreement is signed, you can continue to Stripe to set up " +
        "commission payouts.",
      "",
      "ChargeDrops",
    ].join("\n");
    return sendEmail({
      to: email,
      cc: adminCopyEmail(target.profile, email),
      fromName: "ChargeDrops",
      subject: "Your ChargeDrops agreement is ready to review",
      body,
    });
  }

  async function prepareAgreement({authState, uid, input}) {
    const target = await loadTarget(authState, uid, true);
    const title = "ChargeRent Revenue Share Agreement";
    let generated;
    try {
      generated = await generateChargeRentClientAgreement({
        legalBusinessName: input?.legalBusinessName,
        effectiveDate: input?.effectiveDate,
        assetsDeployed: input?.assetsDeployed,
        venueName: target.profile?.chargedrops?.location?.venueName,
        address: target.profile?.chargedrops?.location?.address,
        contactName: target.profile?.contact?.name,
        contactEmail: target.profile?.contact?.email,
        contactPhone: target.profile?.contact?.phone,
        revenueShare: target.profile?.commission || target.profile?.revShare,
        paymentSchedule: target.profile?.paymentSchedule || "monthly",
      });
    } catch (error) {
      throw failure(
          "invalid-argument",
          error?.message || "The ChargeRent agreement could not be prepared.",
      );
    }
    const version = generated.version;
    const sourcePdf = generated.buffer;
    const fileName = safeFileName(
        `${target.profile?.clientId || "client"}-ChargeRent-Rev-Share-${version}.pdf`,
    );
    const sourceHash = sha256(sourcePdf);
    const agreementRef = db.collection(AGREEMENTS_COLLECTION).doc();
    const agreementId = agreementRef.id;
    const sourceStoragePath =
      `chargedrops/agreements/${target.uid}/${agreementId}/source.pdf`;
    const preparedAt = now();

    await bucket.file(sourceStoragePath).save(sourcePdf, {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
        metadata: {
          agreementId,
          clientUid: target.uid,
          sourceHash,
        },
      },
      preconditionOpts: {ifGenerationMatch: 0},
    });

    const existing = await currentAgreement(target);
    if (existing && existing.agreement.status !== "signed") {
      await existing.ref.set({
        status: "voided",
        voidedAt: serverTimestamp(),
        voidedBy: authState.uid,
        supersededBy: agreementId,
      }, {merge: true});
      await addEvent(existing.ref, "voided", authState, {supersededBy: agreementId});
    }

    const agreement = {
      id: agreementId,
      clientUid: target.uid,
      clientId: text(target.profile.clientId, 80).toUpperCase(),
      venueName: text(target.profile?.chargedrops?.location?.venueName, 160),
      contactEmail: emailForProfile(target.profile),
      title,
      version,
      templateId: generated.templateId,
      templateDetails: generated.details,
      rentalPricing: generated.pricing,
      fileName,
      sourceStoragePath,
      sourceHash,
      sourceSize: sourcePdf.length,
      status: "awaiting_signature",
      preparedAt,
      preparedBy: authState.uid,
      notificationStatus: "pending",
    };
    await agreementRef.set(agreement);
    await addEvent(agreementRef, "prepared", authState, {
      version,
      sourceHash,
      sourceSize: sourcePdf.length,
    });
    await updateProfileAgreement(target, agreement, "awaiting_signature");

    let notificationStatus = "sent";
    try {
      await sendPreparedEmail(target, agreement);
    } catch (error) {
      notificationStatus = "unknown";
      logger.error("ChargeDrops agreement ready email failed", {
        code: text(error?.code, 80) || "unknown",
        agreementId,
        clientUid: target.uid,
      });
    }
    await agreementRef.set({
      notificationStatus,
      notificationUpdatedAt: serverTimestamp(),
    }, {merge: true});
    const partnerNotification = await notifyPartnerSafely(
        target,
        "agreement_ready",
        agreementId,
        authState.uid,
    );
    await agreementRef.set({
      partnerNotifications: {
        agreementReady: {
          status: partnerNotification.status,
          notificationId: text(partnerNotification.id, 160),
          updatedAt: serverTimestamp(),
        },
      },
    }, {merge: true});

    return {
      ok: true,
      agreement: await serializeAgreement({
        id: agreementId,
        ref: agreementRef,
        agreement: {...agreement, notificationStatus},
      }),
    };
  }

  async function getStatus({authState, uid = ""}) {
    const target = await loadTarget(authState, uid);
    return serializeAgreement(await currentAgreement(target));
  }

  async function requestCode({authState}) {
    const target = await loadTarget(authState);
    if (target.uid !== authState.uid || authState.isAdmin === true) {
      throw failure("permission-denied", "The client signer must request the code.");
    }
    const record = await currentAgreement(target);
    if (!record || record.agreement.status !== "awaiting_signature") {
      throw failure("failed-precondition", "There is no agreement ready to sign.");
    }
    const email = emailForProfile(target.profile);
    const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(target.uid);
    const existing = await challengeRef.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    if (timestampMillis(existingData.sentAt) + OTP_RESEND_MS > now().getTime()) {
      throw failure(
          "resource-exhausted",
          "Wait one minute before requesting another verification code.",
      );
    }

    const code = generateCode();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Agreement verification code generator returned an invalid code.");
    }
    const secret = validateOtpSecret(getOtpSecret());
    const sentAt = now();
    const expiresAt = new Date(sentAt.getTime() + OTP_TTL_MS);
    await challengeRef.set({
      agreementId: record.id,
      clientUid: target.uid,
      codeHash: otpHash(secret, record.id, target.uid, code),
      attempts: 0,
      sentAt,
      expiresAt,
      usedAt: null,
    });

    const venue = text(target.profile?.chargedrops?.location?.venueName, 160) ||
      "your ChargeDrops location";
    try {
      await sendEmail({
        to: email,
        fromName: "ChargeDrops",
        subject: "Your ChargeDrops agreement verification code",
        body: [
          `Your verification code is: ${code}`,
          "",
          `Use this code to sign the agreement for ${venue}.`,
          "The code expires in 10 minutes and can be used only once.",
          "",
          "If you did not request this code, do not share it or use it.",
          "",
          "ChargeDrops",
        ].join("\n"),
      });
    } catch (error) {
      await challengeRef.delete();
      logger.error("ChargeDrops agreement code email failed", {
        code: text(error?.code, 80) || "unknown",
        agreementId: record.id,
        clientUid: target.uid,
      });
      throw failure(
          "unavailable",
          "The verification email could not be sent. Try again shortly.",
      );
    }

    await addEvent(record.ref, "verification_code_sent", authState, {
      emailMasked: maskEmail(email),
    });
    return {
      ok: true,
      emailMasked: maskEmail(email),
      expiresInSeconds: OTP_TTL_MS / 1000,
    };
  }

  async function sendCompletionEmail(target, agreement, signedPdf) {
    const email = emailForProfile(target.profile);
    const name = text(target.profile?.contact?.name, 160) || "there";
    await sendEmail({
      to: email,
      cc: adminCopyEmail(target.profile, email),
      fromName: "ChargeDrops",
      subject: "Your client-signed ChargeDrops agreement",
      body: [
        `Hi ${name},`,
        "",
        "Your electronic signature on the ChargeDrops agreement was recorded successfully.",
        `Agreement: ${agreement.title}`,
        `Version: ${agreement.version}`,
        "",
        "The client-signed agreement and electronic-signature certificate are " +
          "attached. A secure copy is also available in your Client Portal.",
        "",
        "ChargeDrops",
      ].join("\n"),
      attachments: [{
        filename: `signed-${safeFileName(agreement.fileName)}`,
        content: signedPdf,
        contentType: "application/pdf",
      }],
    });
  }

  async function signAgreement({authState, input, evidence}) {
    const target = await loadTarget(authState);
    if (target.uid !== authState.uid || authState.isAdmin === true) {
      throw failure("permission-denied", "The client signer must sign the agreement.");
    }
    const record = await currentAgreement(target);
    if (!record) {
      throw failure("failed-precondition", "There is no agreement ready to sign.");
    }
    if (record.agreement.status === "signed") {
      return {ok: true, agreement: await serializeAgreement(record)};
    }
    if (record.agreement.status !== "awaiting_signature") {
      throw failure("failed-precondition", "This agreement cannot be signed.");
    }

    const signerName = text(input?.signerName, 160);
    const signerTitle = text(input?.signerTitle, 120);
    const code = text(input?.code, 12);
    if (signerName.length < 2 || signerTitle.length < 2) {
      throw failure("invalid-argument", "Enter the signer's legal name and title.");
    }
    if (input?.consentElectronic !== true || input?.intentToSign !== true ||
        input?.reviewedDocument !== true) {
      throw failure(
          "invalid-argument",
          "Review the agreement and confirm the electronic-signature consents.",
      );
    }
    if (!/^\d{6}$/.test(code)) {
      throw failure("invalid-argument", "Enter the six-digit verification code.");
    }

    const challengeRef = db.collection(CHALLENGES_COLLECTION).doc(target.uid);
    const challengeSnapshot = await challengeRef.get();
    const challenge = challengeSnapshot.exists ? challengeSnapshot.data() || {} : {};
    const attempts = Number(challenge.attempts || 0);
    const secret = validateOtpSecret(getOtpSecret());
    const validCode = challenge.agreementId === record.id &&
      !challenge.usedAt && attempts < MAX_OTP_ATTEMPTS &&
      timestampMillis(challenge.expiresAt) >= now().getTime() &&
      hashesMatch(
          challenge.codeHash,
          otpHash(secret, record.id, target.uid, code),
      );
    if (!validCode) {
      await challengeRef.set({
        attempts: attempts + 1,
        lastAttemptAt: serverTimestamp(),
        ...(attempts + 1 >= MAX_OTP_ATTEMPTS ? {lockedAt: serverTimestamp()} : {}),
      }, {merge: true});
      throw failure(
          "invalid-argument",
          "The verification code is invalid or expired. Request a new code.",
      );
    }

    const sourceFile = bucket.file(record.agreement.sourceStoragePath);
    const [sourcePdf] = await sourceFile.download();
    if (sha256(sourcePdf) !== record.agreement.sourceHash) {
      logger.error("ChargeDrops agreement source hash mismatch", {
        agreementId: record.id,
        clientUid: target.uid,
      });
      throw failure(
          "failed-precondition",
          "The agreement could not be verified. Contact ChargeDrops support.",
      );
    }

    const signedAt = now();
    const requestEvidence = normalizeRequestEvidence(evidence);
    const signerEmail = emailForProfile(target.profile);
    let signedPdf;
    try {
      signedPdf = await signPdf(sourcePdf, {
        title: record.agreement.title,
        version: record.agreement.version,
        agreementId: record.id,
        clientId: text(target.profile.clientId, 80).toUpperCase(),
        venueName: text(target.profile?.chargedrops?.location?.venueName, 160),
        signerName,
        signerTitle,
        signerEmail,
        signedAt: signedAt.toISOString(),
        sourceHash: record.agreement.sourceHash,
      });
    } catch (error) {
      logger.error("ChargeDrops signed PDF generation failed", {
        agreementId: record.id,
        clientUid: target.uid,
        code: text(error?.code, 80) || "unknown",
      });
      throw failure(
          "failed-precondition",
          "The agreement PDF could not be signed. Contact ChargeDrops support.",
      );
    }

    const signedStoragePath =
      `chargedrops/agreements/${target.uid}/${record.id}/signed.pdf`;
    const signedHash = sha256(signedPdf);
    await bucket.file(signedStoragePath).save(signedPdf, {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
        metadata: {
          agreementId: record.id,
          clientUid: target.uid,
          sourceHash: record.agreement.sourceHash,
          signedHash,
        },
      },
      preconditionOpts: {ifGenerationMatch: 0},
    });

    const signedAgreement = {
      ...record.agreement,
      status: "signed",
      signedAt,
      signedStoragePath,
      signedHash,
      signedSize: signedPdf.length,
      signer: {
        name: signerName,
        title: signerTitle,
        email: signerEmail,
        authMethod: "portal_login_email_otp",
        ...requestEvidence,
      },
      consent: {
        electronicRecords: true,
        reviewedDocument: true,
        intentToSign: true,
      },
      completionEmailStatus: "pending",
    };
    await record.ref.set(signedAgreement, {merge: true});
    await challengeRef.set({
      usedAt: serverTimestamp(),
      attempts,
    }, {merge: true});
    await addEvent(record.ref, "signed", authState, {
      signerName,
      signerTitle,
      signerEmail,
      authMethod: "portal_login_email_otp",
      sourceHash: record.agreement.sourceHash,
      signedHash,
      ...requestEvidence,
    });
    await updateProfileAgreement(target, signedAgreement, "signed");

    let completionEmailStatus = "sent";
    try {
      await sendCompletionEmail(target, signedAgreement, signedPdf);
    } catch (error) {
      completionEmailStatus = "unknown";
      logger.error("ChargeDrops signed agreement email failed", {
        code: text(error?.code, 80) || "unknown",
        agreementId: record.id,
        clientUid: target.uid,
      });
    }
    await record.ref.set({
      completionEmailStatus,
      completionEmailUpdatedAt: serverTimestamp(),
    }, {merge: true});
    const partnerNotification = await notifyPartnerSafely(
        target,
        "agreement_signed",
        record.id,
        authState.uid,
    );
    await record.ref.set({
      partnerNotifications: {
        agreementSigned: {
          status: partnerNotification.status,
          notificationId: text(partnerNotification.id, 160),
          updatedAt: serverTimestamp(),
        },
      },
    }, {merge: true});

    return {
      ok: true,
      agreement: await serializeAgreement({
        ...record,
        agreement: {...signedAgreement, completionEmailStatus},
      }),
    };
  }

  return {
    getStatus,
    prepareAgreement,
    requestCode,
    signAgreement,
  };
}

module.exports = {
  appendSignatureCertificate,
  createChargeDropsAgreementService,
  maskEmail,
  otpHash,
};
