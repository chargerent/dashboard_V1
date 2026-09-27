/* eslint-env node */

const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]{8,}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const ACCOUNT_INCLUDE = [
  "configuration.recipient",
  "defaults",
  "future_requirements",
  "identity",
  "requirements",
];
const ACCOUNT_EVENT_TYPES = new Set([
  "v2.core.account.updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account[identity].updated",
  "v2.core.account[requirements].updated",
]);

function failure(code, message) {
  return Object.assign(new Error(message), {code, safe: true});
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isChargeDropsClient(profile) {
  return profile?.product === "chargedrops" ||
    profile?.portalBrand === "chargedrops" ||
    profile?.products?.chargedrops === true;
}

function countryForProfile(profile) {
  const value = text(
      profile?.chargedrops?.location?.countryCode ||
      profile?.chargedrops?.city?.countryCode,
  ).toUpperCase();
  if (!COUNTRY_RE.test(value)) {
    throw failure(
        "failed-precondition",
        "The venue profile needs a two-letter country before payout setup.",
    );
  }
  return value;
}

function emailForProfile(profile) {
  const email = text(profile?.contact?.email).toLowerCase();
  if (!email || !email.includes("@") || email.length > 254) {
    throw failure(
        "failed-precondition",
        "The venue profile needs a valid contact email before payout setup.",
    );
  }
  return email;
}

function safeName(profile) {
  return text(profile?.chargedrops?.location?.venueName) ||
    text(profile?.contact?.name) ||
    text(profile?.clientId) ||
    "ChargeDrops venue";
}

function requirementCount(account) {
  if (account?.object === "v2.core.account") {
    const entries = account?.requirements?.entries || [];
    return entries.filter((entry) => {
      const status = text(entry?.minimum_deadline?.status);
      return entry?.awaiting_action_from === "user" &&
        ["currently_due", "past_due"].includes(status);
    }).length;
  }
  const fields = [
    ...(account?.requirements?.currently_due || []),
    ...(account?.requirements?.past_due || []),
  ];
  return new Set(fields.map(text).filter(Boolean)).size;
}

function summarizeAccount(account, mode) {
  const dueCount = requirementCount(account);
  const isV2 = account?.object === "v2.core.account";
  const recipientCapabilities =
    account?.configuration?.recipient?.capabilities?.stripe_balance || {};
  const transfersStatus = text(recipientCapabilities?.stripe_transfers?.status);
  const payoutsStatus = text(recipientCapabilities?.payouts?.status);
  const detailsSubmitted = isV2 ?
    dueCount === 0 && account?.applied_configurations?.includes("recipient") :
    account?.details_submitted === true;
  const payoutsEnabled = isV2 ?
    transfersStatus === "active" && payoutsStatus === "active" :
    account?.payouts_enabled === true;
  const ready = detailsSubmitted && payoutsEnabled && dueCount === 0;
  let status = "not_started";
  if (ready) status = "complete";
  else if (dueCount > 0) status = "requirements_due";
  else if (detailsSubmitted) status = "verification_pending";
  else if (account?.id) status = "in_progress";

  return {
    provider: "stripe_connect",
    mode,
    status,
    ready,
    detailsSubmitted,
    payoutsEnabled,
    requirementsDue: dueCount,
    country: text(isV2 ? account?.identity?.country : account?.country)
        .toUpperCase(),
    defaultCurrency: text(isV2 ? account?.defaults?.currency :
      account?.default_currency).toLowerCase(),
    accountReference: text(account?.id).slice(-6),
  };
}

function accountBelongsToClient(account, uid, clientId) {
  return text(account?.metadata?.chargerent_uid) === uid &&
    text(account?.metadata?.chargerent_client_id).toUpperCase() === clientId;
}

function connectUrl(baseUrl, state) {
  const url = new URL(baseUrl);
  url.searchParams.set("chargedropsPayout", state);
  return url.toString();
}

/**
 * Stripe-hosted onboarding for ChargeDrops commission recipients.
 * Raw bank details remain exclusively with Stripe.
 */
function createChargeDropsStripeConnect({
  db,
  admin,
  getStripeClient,
  dashboardBaseUrl = "https://chargerentstations.com/portal/",
  notifyPartner = async () => ({status: "skipped"}),
  logger = console,
}) {
  if (!db || !admin || typeof getStripeClient !== "function") {
    throw new TypeError("ChargeDrops Stripe Connect dependencies are required.");
  }

  async function loadTarget(authState, requestedUid = "") {
    const actorUid = text(authState?.uid);
    const targetUid = text(requestedUid) || actorUid;
    if (!actorUid) throw failure("unauthenticated", "Sign in to continue.");
    if (targetUid !== actorUid && authState?.isAdmin !== true) {
      throw failure(
          "permission-denied",
          "You cannot manage another client's payout account.",
      );
    }
    const ref = db.collection("users").doc(targetUid);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw failure("not-found", "The ChargeDrops client profile was not found.");
    }
    const profile = snapshot.data() || {};
    if (!isChargeDropsClient(profile)) {
      throw failure(
          "failed-precondition",
          "This account is not a ChargeDrops client.",
      );
    }
    return {uid: targetUid, ref, profile};
  }

  function stripeConfiguration() {
    const configured = getStripeClient();
    if (!configured?.stripe || !["test", "live"].includes(configured.mode)) {
      throw failure(
          "failed-precondition",
          "Stripe Connect payout onboarding is not configured.",
      );
    }
    return configured;
  }

  function payoutEventType(status) {
    return {
      in_progress: "payout_started",
      requirements_due: "payout_action_required",
      verification_pending: "payout_verification_pending",
      complete: "payout_complete",
    }[status] || "";
  }

  async function notifyPartnerSafely(
      target,
      account,
      summary,
      actorUid,
      eventTypeOverride = "",
  ) {
    const eventType = eventTypeOverride || payoutEventType(summary.status);
    if (!eventType) return {status: "skipped"};
    try {
      return await notifyPartner({
        clientUid: target.uid,
        clientProfile: target.profile,
        eventType,
        eventKey: `${account.id}:${eventTypeOverride || summary.status}`,
        actorUid: text(actorUid) || "stripe",
      });
    } catch (error) {
      logger.error("ChargeDrops payout partner update failed", {
        clientUid: target.uid,
        eventType,
        code: text(error?.code) || "unknown",
      });
      return {status: "unknown"};
    }
  }

  async function saveSummary(target, account, mode, options = {}) {
    const summary = summarizeAccount(account, mode);
    const payout = target.profile?.chargedrops?.payout || {};
    const previousStatus = text(payout.status);
    const accounts = {
      ...(payout.accounts || {}),
      [mode]: account.id,
    };
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const chargedrops = {
      ...(target.profile.chargedrops || {}),
      payout: {
        ...payout,
        ...summary,
        accounts,
        updatedAt: timestamp,
      },
      onboarding: {
        ...(target.profile?.chargedrops?.onboarding || {}),
        payoutStatus: summary.ready ? "complete" : "in_progress",
        payoutUpdatedAt: timestamp,
      },
    };
    await target.ref.set({chargedrops, updatedAt: timestamp}, {merge: true});
    target.profile = {...target.profile, chargedrops};
    let partnerNotification = {status: "skipped"};
    if (options.notifyPartner !== false && previousStatus !== summary.status) {
      partnerNotification = await notifyPartnerSafely(
          target,
          account,
          summary,
          options.actorUid,
      );
      await target.ref.update({
        "chargedrops.onboarding.partnerPayoutNotification": {
          eventType: payoutEventType(summary.status),
          status: partnerNotification.status,
          notificationId: text(partnerNotification.id),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }
    return {...summary, partnerNotificationStatus: partnerNotification.status};
  }

  async function retrieveOwnedAccount(target, stripe, mode) {
    const payout = target.profile?.chargedrops?.payout || {};
    const accountId = text(payout?.accounts?.[mode]) ||
      (payout.mode === mode ? text(payout.stripeAccountId) : "");
    if (!accountId) return null;
    if (!ACCOUNT_ID_RE.test(accountId)) {
      throw failure(
          "failed-precondition",
          "The saved Stripe payout account reference is invalid.",
      );
    }
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ACCOUNT_INCLUDE,
    });
    const clientId = text(target.profile.clientId).toUpperCase();
    if (!accountBelongsToClient(account, target.uid, clientId)) {
      throw failure(
          "permission-denied",
          "The Stripe payout account does not belong to this client.",
      );
    }
    return account;
  }

  async function ensureAccount(target, stripe, mode) {
    const existing = await retrieveOwnedAccount(target, stripe, mode);
    if (existing) return {account: existing, created: false};

    const country = countryForProfile(target.profile);
    const email = emailForProfile(target.profile);
    const clientId = text(target.profile.clientId).toUpperCase();
    const website = text(target.profile?.chargedrops?.location?.website);
    const account = await stripe.v2.core.accounts.create({
      display_name: safeName(target.profile).slice(0, 100),
      contact_email: email,
      dashboard: "express",
      defaults: {
        profile: {
          doing_business_as: safeName(target.profile).slice(0, 100),
          product_description: "ChargeDrops venue revenue-share commissions",
          ...(website.startsWith("https://") ? {business_url: website} : {}),
        },
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      identity: {country},
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {requested: true},
            },
          },
        },
      },
      metadata: {
        chargerent_uid: target.uid,
        chargerent_client_id: clientId,
        chargedrops_venue: safeName(target.profile).slice(0, 200),
      },
      include: ACCOUNT_INCLUDE,
    }, {
      idempotencyKey: `chargedrops-connect-${mode}-${target.uid}-${country}`,
    });
    if (!ACCOUNT_ID_RE.test(text(account?.id))) {
      throw failure(
          "unavailable",
          "Stripe did not create a usable payout account.",
      );
    }
    await saveSummary(target, account, mode, {notifyPartner: false});
    return {account, created: true};
  }

  async function safely(operation, targetUid = "") {
    try {
      return await operation();
    } catch (error) {
      if (error?.safe) throw error;
      logger.error("ChargeDrops Stripe Connect request failed", {
        code: text(error?.code) || "unknown",
        type: text(error?.type) || "unknown",
        targetUid: text(targetUid),
      });
      throw failure(
          "unavailable",
          "Stripe payout setup is temporarily unavailable. Try again shortly.",
      );
    }
  }

  async function getStatus({authState, uid = ""}) {
    return safely(async () => {
      const target = await loadTarget(authState, uid);
      const {stripe, mode} = stripeConfiguration();
      const account = await retrieveOwnedAccount(target, stripe, mode);
      if (!account) {
        return {
          provider: "stripe_connect",
          mode,
          status: "not_started",
          ready: false,
          detailsSubmitted: false,
          payoutsEnabled: false,
          requirementsDue: 0,
        };
      }
      return saveSummary(target, account, mode, {actorUid: authState.uid});
    }, uid);
  }

  async function createOnboardingLink({authState, uid = ""}) {
    return safely(async () => {
      const target = await loadTarget(authState, uid);
      if (text(target.profile?.chargedrops?.onboarding?.agreementStatus) !==
          "signed") {
        throw failure(
            "failed-precondition",
            "Sign the ChargeDrops agreement before setting up payouts.",
        );
      }
      const {stripe, mode} = stripeConfiguration();
      const {account, created} = await ensureAccount(target, stripe, mode);
      const summary = await saveSummary(target, account, mode, {
        notifyPartner: false,
      });
      const linkType = summary.detailsSubmitted ?
        "account_update" : "account_onboarding";
      const useCaseKey = linkType === "account_onboarding" ?
        "account_onboarding" : "account_update";
      const link = await stripe.v2.core.accountLinks.create({
        account: account.id,
        use_case: {
          type: linkType,
          [useCaseKey]: {
            configurations: ["recipient"],
            refresh_url: connectUrl(dashboardBaseUrl, "refresh"),
            return_url: connectUrl(dashboardBaseUrl, "return"),
            ...(linkType === "account_onboarding" ? {collection_options: {
              fields: "eventually_due",
              future_requirements: "include",
            }} : {}),
          },
        },
      });
      if (!text(link?.url).startsWith("https://connect.stripe.com/")) {
        throw failure(
            "unavailable",
            "Stripe did not return a secure onboarding link.",
        );
      }
      const partnerNotification = await notifyPartnerSafely(
          target,
          account,
          summary,
          authState.uid,
          created ? "payout_started" : "",
      );
      return {
        ...summary,
        partnerNotificationStatus: partnerNotification.status,
        url: link.url,
        expiresAt: Math.floor(Date.parse(link.expires_at || "") / 1000) || 0,
      };
    }, uid);
  }

  async function syncAccountUpdate(account) {
    const uid = text(account?.metadata?.chargerent_uid);
    const clientId = text(
        account?.metadata?.chargerent_client_id,
    ).toUpperCase();
    if (!uid || !clientId || !ACCOUNT_ID_RE.test(text(account?.id))) {
      return {ignored: true, reason: "unmanaged-account"};
    }
    const target = await loadTarget({uid, isAdmin: false});
    if (text(target.profile.clientId).toUpperCase() !== clientId ||
        !accountBelongsToClient(account, uid, clientId)) {
      return {ignored: true, reason: "metadata-mismatch"};
    }
    const mode = account.livemode === true ? "live" : "test";
    return saveSummary(target, account, mode, {actorUid: "stripe-webhook"});
  }

  async function syncEventNotification(event) {
    const eventType = text(event?.type);
    if (eventType === "v2.core.event_destination.ping") {
      return {ignored: true, reason: "ping"};
    }

    let accountId = "";
    if (ACCOUNT_EVENT_TYPES.has(eventType)) {
      accountId = text(event?.related_object?.id);
    } else if (eventType === "v2.core.account_link.returned") {
      const fullEvent = await event.fetchEvent();
      const configurations = fullEvent?.data?.configurations || [];
      if (!configurations.includes("recipient")) {
        return {ignored: true, reason: "unmanaged-configuration"};
      }
      accountId = text(fullEvent?.data?.account_id);
    } else {
      return {ignored: true, reason: "unsupported-event"};
    }

    if (!ACCOUNT_ID_RE.test(accountId)) {
      return {ignored: true, reason: "invalid-account"};
    }
    const {stripe} = stripeConfiguration();
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ACCOUNT_INCLUDE,
    });
    return syncAccountUpdate(account);
  }

  return {
    getStatus,
    createOnboardingLink,
    syncAccountUpdate,
    syncEventNotification,
  };
}

module.exports = {
  createChargeDropsStripeConnect,
  summarizeAccount,
};
