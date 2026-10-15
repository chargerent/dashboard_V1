/* eslint-env node */

const STRIPE_ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,}$/;
const STRIPE_TRANSFER_RE = /^tr_[A-Za-z0-9]{8,}$/;

function failure(code, message) {
  return Object.assign(new Error(message), {code, safe: true});
}

function text(value, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function amountToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function availableBalance(balance, currency) {
  return (balance?.available || [])
      .filter((entry) => text(entry?.currency).toLowerCase() === currency)
      .reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0);
}

function isChargeDropsClient(profile) {
  return profile?.product === "chargedrops" ||
    profile?.portalBrand === "chargedrops" ||
    profile?.products?.chargedrops === true;
}

function createChargeDropsPayoutTransfers({
  db,
  admin,
  getStripeClient,
  expectedPlatformAccountId,
  reportsCollection = "payoutReports",
  logger = console,
}) {
  if (!db || !admin || typeof getStripeClient !== "function" ||
      !STRIPE_ACCOUNT_RE.test(text(expectedPlatformAccountId))) {
    throw new TypeError("ChargeDrops payout transfer dependencies are required.");
  }
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function loadReport(reportId) {
    const ref = db.collection(reportsCollection).doc(reportId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw failure("not-found", "Payout report not found.");
    return {ref, report: snapshot.data() || {}};
  }

  async function loadClient(report) {
    const uid = text(report?.client?.uid, 160);
    if (!uid) {
      throw failure("failed-precondition", "The payout report is missing its client account.");
    }
    const snapshot = await db.collection("users").doc(uid).get();
    const profile = snapshot.exists ? snapshot.data() || {} : null;
    if (!profile || !isChargeDropsClient(profile)) {
      throw failure("failed-precondition", "The ChargeDrops client account was not found.");
    }
    return {uid, profile};
  }

  async function verifyPlatform(stripe, mode) {
    if (mode !== "live") {
      throw failure(
          "failed-precondition",
          "Real ChargeDrops payouts require the live Ocharge Stripe account.",
      );
    }
    const account = await stripe.accounts.retrieve(null);
    if (text(account?.id) !== expectedPlatformAccountId) {
      throw failure(
          "failed-precondition",
          "The configured Stripe key is not connected to the approved Ocharge account.",
      );
    }
    return account;
  }

  async function approve({reportId, authState}) {
    const normalizedId = text(reportId, 240);
    if (!normalizedId) throw failure("invalid-argument", "reportId required.");
    if (authState?.isAdmin !== true) {
      throw failure("permission-denied", "Only an administrator can approve payouts.");
    }

    const {ref, report} = await loadReport(normalizedId);
    if (report.model !== "chargedrops" || report.type !== "purchase_approval") {
      throw failure("failed-precondition", "This is not a ChargeDrops client payout.");
    }
    if (["transferred", "paid"].includes(report.status) &&
        STRIPE_TRANSFER_RE.test(text(report?.transfer?.id))) {
      return {ok: true, reportId: normalizedId, duplicate: true, transfer: report.transfer};
    }
    if (!["pending_approval", "processing"].includes(report.status)) {
      throw failure("failed-precondition", "Only pending ChargeDrops payouts can be approved.");
    }
    if (report.revenueBasis !== "gross_minus_refunds_and_taxes_v1") {
      throw failure(
          "failed-precondition",
          "Regenerate this payout report with the current revenue calculation before approving it.",
      );
    }
    const currency = text(report.currency).toLowerCase();
    if (currency !== "usd") {
      throw failure(
          "failed-precondition",
          "This Ocharge payout flow currently supports USD reports only.",
      );
    }
    const amount = amountToCents(report?.totals?.clientShare);
    if (amount <= 0) {
      throw failure("failed-precondition", "The client payout amount must be greater than zero.");
    }

    const client = await loadClient(report);
    if (text(client.profile?.chargedrops?.onboarding?.agreementStatus) !==
        "fully_executed") {
      throw failure(
          "failed-precondition",
          "Ocharge must countersign the client agreement before payouts are unlocked.",
      );
    }
    const payout = client.profile?.chargedrops?.payout || {};
    const destination = text(payout?.accounts?.live);
    if (payout.mode !== "live" || payout.ready !== true ||
        !STRIPE_ACCOUNT_RE.test(destination)) {
      throw failure(
          "failed-precondition",
          "The client's live Stripe payout account is not ready.",
      );
    }

    const configured = getStripeClient();
    if (!configured?.stripe) {
      throw failure("failed-precondition", "Stripe payouts are not configured.");
    }
    const stripe = configured.stripe;
    let processingStarted = false;
    try {
      await verifyPlatform(stripe, configured.mode);
      const balance = await stripe.balance.retrieve();
      if (availableBalance(balance, currency) < amount) {
        throw failure(
            "failed-precondition",
            "The Ocharge Stripe balance is too low for this payout. Fund the Stripe balance from Chase, then approve again.",
        );
      }

      await ref.set({
        status: "processing",
        approvalStartedAt: timestamp(),
        approvalStartedByUid: text(authState.uid, 160),
        updatedAt: timestamp(),
      }, {merge: true});
      processingStarted = true;

      const transfer = await stripe.transfers.create({
        amount,
        currency,
        destination,
        description: `ChargeDrops client revenue share - ${text(report?.period?.label, 120)}`,
        metadata: {
          chargedrops_payout_report_id: normalizedId,
          chargerent_client_uid: client.uid,
          chargerent_client_id: text(report?.client?.clientId, 80).toUpperCase(),
          revenue_basis: report.revenueBasis,
        },
      }, {
        idempotencyKey: `chargedrops-client-payout-${normalizedId}`,
      });
      if (!STRIPE_TRANSFER_RE.test(text(transfer?.id))) {
        throw new Error("Stripe did not return a valid transfer reference.");
      }

      const transferRecord = {
        id: transfer.id,
        amount,
        currency,
        destinationReference: destination.slice(-6),
        platformAccountId: expectedPlatformAccountId,
        livemode: transfer.livemode === true,
        providerStatus: "created",
        fundingSource: "stripe_platform_available_balance",
        createdAt: timestamp(),
      };
      await ref.set({
        status: "transferred",
        approvedAt: timestamp(),
        transferredAt: timestamp(),
        approvedByUid: text(authState.uid, 160),
        approvedByUsername: text(authState?.profile?.username, 160).toLowerCase(),
        transfer: transferRecord,
        updatedAt: timestamp(),
      }, {merge: true});
      return {ok: true, reportId: normalizedId, transfer: transferRecord};
    } catch (error) {
      if (!error?.safe) {
        logger.error("ChargeDrops Stripe transfer failed", {
          reportId: normalizedId,
          code: text(error?.code, 80) || "unknown",
          type: text(error?.type, 80) || "unknown",
        });
      }
      if (processingStarted) {
        await ref.set({
          status: "pending_approval",
          transferError: {
            code: text(error?.code, 80) || "unknown",
            failedAt: timestamp(),
          },
          updatedAt: timestamp(),
        }, {merge: true});
      }
      if (error?.safe) throw error;
      throw failure(
          "unavailable",
          "Stripe could not create the client transfer. No payout was recorded; try again after checking Stripe.",
      );
    }
  }

  return {approve};
}

module.exports = {
  amountToCents,
  availableBalance,
  createChargeDropsPayoutTransfers,
};
