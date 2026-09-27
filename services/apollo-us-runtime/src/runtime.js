import {randomUUID} from 'node:crypto';
import {FieldValue} from '@google-cloud/firestore';
import {cardSchema, classifyCardMethod, normalizeSerial, safeCardSummary, terminalStateSchema, uiNotificationSchema} from './contracts.js';
import {buildCallbackBaseUrl, buildQrStartRequest, buildStopRequest, buildTerminalRequest, buildUiRequest, callPayter} from './payter.js';
import {resolveTerminalProfile, resolveTerminalProfileByStation} from './profile.js';
import {buildAvailabilityCommand, buildVendCommand} from './qr.js';
import {advanceToQrScan, authorizeQrForVend, beginQrVendSession, claimEvent, completeEvent, failSession, finalizeVend} from './store.js';

const localeCopy = (release, language) => release.content.translations?.[language] || release.content.translations?.en || {};
const screenMessage = (release, language, screenId, fallback) => {
  const screen = localeCopy(release, language)?.[screenId] || {};
  return {title: screen.title || fallback.title, message: screen.message || screen.subtitle || fallback.message};
};

export const startScreenProperties = (release, language) => {
  const copy = localeCopy(release, language)?.startpage || {};
  return {
    title: copy.title || 'Welcome',
    subtitle: copy.subtitle || 'Press Start',
    'cards.0': '',
    'cards.0.logo': 'mastercard',
    'cards.0.cardholder': 'Mastercard',
    'cards.1': '',
    'cards.1.logo': 'visa',
    'cards.1.cardholder': 'Visa',
    'cards.3': '',
    'cards.3.logo': 'amex',
    'cards.3.cardholder': 'AMEX',
    'buttons.start': '',
    'buttons.start.label': copy.startbutton || 'Start',
    'buttons.lang': '',
    'buttons.lang.language': 'true',
  };
};

const passiveScreenProperties = ({title, message}) => ({title, subtitle: message});

const takeChargerProperties = (release, language) => {
  const copy = screenMessage(release, language, 'thankyoupage', {title: 'Take your charger', message: 'Remove it from the kiosk'});
  return {title: copy.title, subtitle: copy.message};
};

const returnCompleteProperties = (release, language) => {
  const copy = localeCopy(release, language)?.returntypage || {};
  const defaults = {en: 'Return accepted', es: 'Devolución aceptada', fr: 'Retour accepté'};
  const legacyAccepted = {en: /^accepted$/i, es: /^aceptado$/i, fr: /^accepté$/i};
  const configuredMessage = String(copy.message || '').trim();
  const title = !configuredMessage || legacyAccepted[language]?.test(configuredMessage)
    ? defaults[language] || defaults.en
    : configuredMessage;
  return {title, subtitle: ''};
};

const failedMessage = (release, language, reason) => {
  const screenId = reason === 'unavailable' ? 'soldoutpage' : reason === 'qr_timeout' ? 'nocardpage' : 'canceledpage';
  const fallback = reason === 'unavailable'
    ? {title: 'Unable to continue', message: 'No chargers are available'}
    : reason === 'qr_timeout'
      ? {title: 'No QR scanned', message: 'Please try again'}
      : {title: 'Unable to continue', message: 'The QR code could not be accepted'};
  return screenMessage(release, language, screenId, fallback);
};

const normalizeLanguage = (value) => {
  const language = String(value || 'en').trim().toLowerCase();
  if (!['en', 'es', 'fr'].includes(language)) throw new Error('Unsupported language.');
  return language;
};

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createRuntime({
  config,
  db,
  loadSecret,
  mqttClient,
  makeId = randomUUID,
  payterCall = callPayter,
  sleep = defaultSleep,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}) {
  const readerTimers = new Map();

  function clearReaderTimer(serialNumber, sessionId = '') {
    const serial = normalizeSerial(serialNumber);
    const active = readerTimers.get(serial);
    if (!active || (sessionId && active.sessionId !== sessionId)) return;
    cancelTimeout(active.handle);
    readerTimers.delete(serial);
  }

  async function publishCommand(stationId, command) {
    if (String(command.stationid || '').trim().toUpperCase() !== String(stationId || '').trim().toUpperCase()) {
      throw new Error('V2 command station does not match the resolved Apollo terminal.');
    }
    await mqttClient.publishAsync('CSTA/get', JSON.stringify(command), {qos: 2, retain: false});
  }

  async function showScreen(serialNumber, screenId, properties, type = 'message') {
    const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
    const callbackBaseUrl = buildCallbackBaseUrl(config.PUBLIC_BASE_URL, await loadSecret(config.CALLBACK_TOKEN_SECRET));
    return payterCall(buildUiRequest({
      apiKey,
      callbackBaseUrl,
      cpsEnvironment: config.CPS_ENVIRONMENT,
      properties,
      screenId,
      serialNumber,
      type,
    }));
  }

  async function activateTerminal(serialValue, languageValue = 'en') {
    const serial = normalizeSerial(serialValue);
    clearReaderTimer(serial);
    const language = normalizeLanguage(languageValue);
    const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, serial);
    if (resolved.release.content.qr?.enabled !== true) throw new Error('QR vending is disabled in the assigned client profile.');
    if (resolved.terminal.scannerOnly !== true) throw new Error('Apollo scanner-only mode is not enabled for this terminal.');
    const screenId = `start-${String(makeId()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`;
    try {
      await showScreen(serial, screenId, startScreenProperties(resolved.release, language), 'carousel');
    } catch (error) {
      await db.collection('apolloTerminalRuntime').doc(serial).set({
        environment: config.APOLLO_ENVIRONMENT,
        terminalSerial: serial,
        stationId: resolved.stationId,
        clientId: resolved.clientId,
        releaseId: resolved.releaseId,
        language,
        state: 'start_failed',
        failureReason: error.message.slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw error;
    }
    await db.collection('apolloTerminalRuntime').doc(serial).set({
      environment: config.APOLLO_ENVIRONMENT,
      terminalSerial: serial,
      stationId: resolved.stationId,
      clientId: resolved.clientId,
      releaseId: resolved.releaseId,
      language,
      state: 'idle',
      activeScreenId: screenId,
      activeSessionId: '',
      readerSessionId: '',
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return {ok: true, screenId, serialNumber: serial, stationId: resolved.stationId};
  }

  async function activateTerminalIfState(serialNumber, language, expectedState) {
    const serial = normalizeSerial(serialNumber);
    const runtimeRef = db.collection('apolloTerminalRuntime').doc(serial);
    const claimed = await db.runTransaction(async (transaction) => {
      const runtimeSnap = await transaction.get(runtimeRef);
      if (!runtimeSnap.exists || runtimeSnap.data()?.state !== expectedState) return false;
      transaction.set(runtimeRef, {state: 'returning_to_start', updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      return true;
    });
    if (!claimed) return false;
    await activateTerminal(serial, language);
    return true;
  }

  async function recoverTerminalInStates(serialValue, trigger, recoverableStates) {
    const serial = normalizeSerial(serialValue);
    const runtimeRef = db.collection('apolloTerminalRuntime').doc(serial);
    const claimed = await db.runTransaction(async (transaction) => {
      const runtimeSnap = await transaction.get(runtimeRef);
      const terminalRuntime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
      if (runtimeSnap.exists && !recoverableStates.includes(terminalRuntime.state)) {
        return {claimed: false};
      }
      transaction.set(runtimeRef, {
        state: 'recovering_start_screen',
        recoveryTrigger: String(trigger).slice(0, 80),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      return {claimed: true, language: terminalRuntime.language || 'en'};
    });
    if (!claimed.claimed) return {recovered: false, reason: 'terminal_busy', trigger};
    try {
      await activateTerminal(serial, claimed.language);
      return {recovered: true, trigger};
    } catch (error) {
      await runtimeRef.set({
        state: 'start_failed',
        failureReason: error.message.slice(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw error;
    }
  }

  function recoverIdleTerminal(serialValue, trigger = 'terminal_state') {
    const restartRecoveryStates = [
      'idle',
      'start_failed',
      'take_charger',
      'showing_return',
      'showing_failure',
      'returning_to_start',
      'recovering_start_screen',
    ];
    const recoverableStates = ['runtime_startup', 'terminal_reconnected'].includes(trigger)
      ? restartRecoveryStates
      : ['idle', 'start_failed'];
    return recoverTerminalInStates(serialValue, trigger, recoverableStates);
  }

  function retryFailedStart(serialValue) {
    return recoverTerminalInStates(serialValue, 'start_failure_retry', ['start_failed']);
  }

  async function showFailureAndReset(resolved, session, reason) {
    const language = session?.language || 'en';
    await db.collection('apolloTerminalRuntime').doc(resolved.serial).set({state: 'showing_failure', updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    try {
      await showScreen(
        resolved.serial,
        `failure-${String(makeId()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
        passiveScreenProperties(failedMessage(resolved.release, language, reason)),
        'dispense',
      );
      await sleep(config.SCREEN_RETURN_DELAY_MS);
    } catch (error) {
      console.warn(JSON.stringify({event: 'apollo_failure_screen_failed', message: error.message, stationId: resolved.stationId}));
    }
    await activateTerminal(resolved.serial, language);
  }

  async function startQrReader(resolved, session) {
    const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
    const callbackToken = await loadSecret(config.CALLBACK_TOKEN_SECRET);
    const callbackBaseUrl = buildCallbackBaseUrl(config.PUBLIC_BASE_URL, callbackToken);
    const readerSessionId = makeId();
    const runtimeRef = db.collection('apolloTerminalRuntime').doc(resolved.serial);
    await runtimeRef.set({
      activeSessionId: session.sessionId,
      readerSessionId,
      state: 'starting_reader',
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    try {
      const startResult = await payterCall(buildQrStartRequest({
        apiKey,
        callbackUrl: `${callbackBaseUrl}/readers/${readerSessionId}/card`,
        cpsEnvironment: config.CPS_ENVIRONMENT,
        language: session.language || 'en',
        promptMessage: resolved.release.content.qr.promptMessage,
        promptTitle: resolved.release.content.qr.promptTitle,
        serialNumber: resolved.serial,
      }));
      let terminalState = '';
      for (let attempt = 0; attempt < config.QR_READER_STATE_ATTEMPTS; attempt += 1) {
        await sleep(config.QR_READER_STATE_POLL_MS);
        const statusResult = await payterCall(buildTerminalRequest({
          apiKey,
          cpsEnvironment: config.CPS_ENVIRONMENT,
          serialNumber: resolved.serial,
        }));
        let terminal;
        try {
          terminal = JSON.parse(statusResult.body || '{}');
        } catch {
          throw new Error('Payter returned an invalid terminal status response.');
        }
        if (terminal.online !== true) throw new Error('Payter terminal went offline while starting the QR reader.');
        terminalState = String(terminal.state || '').trim().toUpperCase();
        if (['READING', 'CARD'].includes(terminalState)) {
          const runtimeSnap = await runtimeRef.get();
          if (runtimeSnap.data()?.state !== 'callback_received') {
            await runtimeRef.set({
              state: 'reading',
              readerDeadlineAt: new Date(Date.now() + config.QR_READER_TIMEOUT_MS),
              startedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }, {merge: true});
          }
          clearReaderTimer(resolved.serial);
          const timeoutHandler = scheduleTimeout(async () => {
            readerTimers.delete(resolved.serial);
            try {
              const [latestRuntimeSnap, latestSessionSnap] = await Promise.all([
                runtimeRef.get(),
                db.collection('apolloVendSessions').doc(session.sessionId).get(),
              ]);
              const latestRuntime = latestRuntimeSnap.data() || {};
              const latestSession = latestSessionSnap.data() || {};
              if (latestRuntime.activeSessionId !== session.sessionId || latestRuntime.readerSessionId !== readerSessionId) return;
              if (latestRuntime.state !== 'reading' || latestSession.state !== 'awaiting_qr') return;
              await payterCall(buildStopRequest({apiKey, cpsEnvironment: config.CPS_ENVIRONMENT, serialNumber: resolved.serial})).catch(() => {});
              await failSession(db, latestSession, 'qr_timeout');
              await showFailureAndReset(resolved, latestSession, 'qr_timeout');
              console.info(JSON.stringify({event: 'apollo_qr_reader_timeout', sessionId: session.sessionId, stationId: resolved.stationId}));
            } catch (error) {
              console.error(JSON.stringify({event: 'apollo_qr_reader_timeout_failed', message: error.message, sessionId: session.sessionId, stationId: resolved.stationId}));
            }
          }, config.QR_READER_TIMEOUT_MS);
          timeoutHandler?.unref?.();
          readerTimers.set(resolved.serial, {handle: timeoutHandler, sessionId: session.sessionId});
          console.info(JSON.stringify({event: 'apollo_qr_reader_started', sessionId: session.sessionId, stationId: resolved.stationId, terminalState}));
          return startResult;
        }
      }
      throw new Error(`Payter terminal did not enter READING (last state ${terminalState || 'UNKNOWN'}).`);
    } catch (error) {
      clearReaderTimer(resolved.serial, session.sessionId);
      await payterCall(buildStopRequest({apiKey, cpsEnvironment: config.CPS_ENVIRONMENT, serialNumber: resolved.serial})).catch(() => {});
      await runtimeRef.set({state: 'start_failed', failureReason: error.message.slice(0, 500), updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      throw error;
    }
  }

  async function stopQrReader(serialNumber) {
    const apiKey = await loadSecret(config.PAYTER_API_KEY_SECRET);
    return payterCall(buildStopRequest({apiKey, cpsEnvironment: config.CPS_ENVIRONMENT, serialNumber}));
  }

  async function handleUi(envelope) {
    const notification = uiNotificationSchema.parse(envelope.payload);
    if (!['ok', 'start'].includes(notification.response.trim().toLowerCase())) return;
    const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, notification.serialNumber);
    if (resolved.release.content.qr?.enabled !== true || resolved.terminal.scannerOnly !== true) return;
    const runtimeSnap = await db.collection('apolloTerminalRuntime').doc(resolved.serial).get();
    const language = normalizeLanguage(runtimeSnap.exists ? runtimeSnap.data()?.language : 'en');
    const started = await beginQrVendSession({
      clientId: resolved.clientId,
      db,
      environment: config.APOLLO_ENVIRONMENT,
      language,
      releaseId: resolved.releaseId,
      screenId: notification.screenId,
      serial: resolved.serial,
      sessionId: envelope.eventId,
      stationId: resolved.stationId,
    });
    if (!started.created) return;
    try {
      await showScreen(
        resolved.serial,
        `availability-${envelope.eventId.slice(0, 12)}`,
        passiveScreenProperties(screenMessage(resolved.release, language, 'availabilitypage', {title: 'Please wait', message: 'Checking availability'})),
        'info',
      );
      await publishCommand(resolved.stationId, buildAvailabilityCommand({
        sessionId: envelope.eventId,
        stationId: resolved.stationId,
        terminalSerial: resolved.serial,
      }));
      console.info(JSON.stringify({event: 'apollo_inventory_requested', sessionId: envelope.eventId, stationId: resolved.stationId}));
    } catch (error) {
      await failSession(db, started.session, 'availability_dispatch_failed');
      await showFailureAndReset(resolved, started.session, 'availability_dispatch_failed');
      throw error;
    }
  }

  async function handleCard(envelope) {
    const card = cardSchema.parse(envelope.payload);
    const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, card.serialNumber);
    const runtimeSnap = await db.collection('apolloTerminalRuntime').doc(resolved.serial).get();
    const terminalRuntime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
    const sessionId = String(terminalRuntime.activeSessionId || '').trim();
    if (!sessionId || terminalRuntime.readerSessionId !== card.readerSessionId) throw new Error('QR callback is not linked to the active Apollo session.');
    const sessionSnap = await db.collection('apolloVendSessions').doc(sessionId).get();
    const session = sessionSnap.exists ? sessionSnap.data() : null;
    if (!session) throw new Error('Apollo vend session was not found for the QR callback.');

    clearReaderTimer(resolved.serial, sessionId);
    await stopQrReader(resolved.serial);
    if (resolved.release.content.qr?.enabled !== true || resolved.terminal.scannerOnly !== true) {
      await failSession(db, session, 'scanner_disabled');
      await showFailureAndReset(resolved, session, 'scanner_disabled');
      return;
    }

    const qrHashKey = await loadSecret(config.QR_HASH_SECRET);
    const acceptAnyQr = config.APOLLO_ENVIRONMENT === 'us-lab' && resolved.terminal.acceptAnyQr === true;
    const cardMethod = classifyCardMethod(card);
    // The isolated Payter test build reports successful camera reads with a
    // generic interface value instead of QR_CODE. The lab-only any-QR switch
    // is already scoped to a scanner-only terminal and a unique QR reader
    // session, so accept that callback for the physical pilot. Production
    // continues to require Payter to identify the callback as QR_CODE.
    if (!acceptAnyQr && cardMethod !== 'QR_CODE') {
      console.warn(JSON.stringify({event: 'apollo_qr_method_rejected', card: safeCardSummary(card), sessionId, stationId: resolved.stationId}));
      await failSession(db, session, 'unsupported_card_method');
      await showFailureAndReset(resolved, session, 'unsupported_card_method');
      return;
    }
    const authorized = await authorizeQrForVend({
      acceptAnyQr,
      clientId: resolved.clientId,
      credentialProvider: resolved.release.content.qr.provider,
      db,
      environment: config.APOLLO_ENVIRONMENT,
      qrHashKey,
      rawCredential: card.cardId,
      sessionId,
    });
    if (!authorized.ok) {
      await failSession(db, session, authorized.reason);
      await showFailureAndReset(resolved, session, authorized.reason);
      return;
    }

    try {
      await db.collection('apolloTerminalRuntime').doc(resolved.serial).set({state: 'dispensing', updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      await showScreen(
        resolved.serial,
        `dispensing-${sessionId.slice(0, 12)}`,
        passiveScreenProperties(screenMessage(resolved.release, session.language || 'en', 'ejectpage', {title: 'Please wait', message: 'Dispensing charger'})),
        'info',
      );
      await publishCommand(resolved.stationId, buildVendCommand({
        chargerId: authorized.session.chargerId,
        clientId: authorized.session.clientId,
        credentialProvider: authorized.session.credentialProvider,
        module: authorized.session.module,
        sessionId,
        slot: authorized.session.slot,
        stationId: authorized.session.stationId,
        terminalSerial: authorized.session.terminalSerial,
      }));
      console.info(JSON.stringify({event: 'qr_authorized', sessionId, card: safeCardSummary(card), stationId: resolved.stationId, testAnyQr: acceptAnyQr}));
    } catch (error) {
      await failSession(db, authorized.session, 'vend_dispatch_failed');
      await showFailureAndReset(resolved, authorized.session, 'vend_dispatch_failed');
      throw error;
    }
  }

  async function handleKioskEvent(envelope) {
    const event = envelope.payload;
    if (event.type === 'heartbeat') return;
    if (event.type === 'return_result') {
      const resolved = await resolveTerminalProfileByStation(db, config.APOLLO_ENVIRONMENT, event.stationId);
      if (!resolved) return;
      const runtimeRef = db.collection('apolloTerminalRuntime').doc(resolved.serial);
      const claimed = await db.runTransaction(async (transaction) => {
        const runtimeSnap = await transaction.get(runtimeRef);
        const terminalRuntime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
        if (!['idle', 'take_charger'].includes(terminalRuntime.state)) return false;
        transaction.set(runtimeRef, {
          state: 'showing_return',
          lastReturnEventId: envelope.eventId,
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        return true;
      });
      if (!claimed) {
        console.info(JSON.stringify({event: 'apollo_return_screen_skipped_busy', stationId: resolved.stationId}));
        return;
      }
      const runtimeSnap = await runtimeRef.get();
      const language = normalizeLanguage(runtimeSnap.data()?.language || 'en');
      await showScreen(
        resolved.serial,
        `return-${String(makeId()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
        returnCompleteProperties(resolved.release, language),
        'info',
      );
      console.info(JSON.stringify({event: 'apollo_return_screen_shown', stationId: resolved.stationId, module: String(event.module), slot: String(event.slot)}));
      await sleep(config.SCREEN_RETURN_DELAY_MS);
      await activateTerminalIfState(resolved.serial, language, 'showing_return');
      return;
    }
    if (event.type === 'availability_result') {
      const result = await advanceToQrScan(db, event);
      if (!result.ok) {
        if (result.reason === 'unavailable' && result.session) {
          const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, result.session.terminalSerial);
          await showFailureAndReset(resolved, result.session, 'unavailable');
        }
        return;
      }
      const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, result.session.terminalSerial);
      try {
        await sleep(config.AVAILABILITY_MIN_DISPLAY_MS);
        await startQrReader(resolved, result.session);
      } catch (error) {
        await failSession(db, result.session, 'reader_start_failed');
        await showFailureAndReset(resolved, result.session, 'reader_start_failed');
        throw error;
      }
      return;
    }
    if (event.type === 'vend_result') {
      const result = await finalizeVend(db, event);
      if (!result.session) return;
      const resolved = await resolveTerminalProfile(db, config.APOLLO_ENVIRONMENT, result.session.terminalSerial);
      const language = result.session.language || 'en';
      await db.collection('apolloTerminalRuntime').doc(resolved.serial).set({state: result.ok ? 'take_charger' : 'showing_failure', updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      if (result.ok) {
        await showScreen(resolved.serial, `take-${String(makeId()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`, takeChargerProperties(resolved.release, language), 'dispense');
        await sleep(config.SCREEN_RETURN_DELAY_MS);
        await activateTerminalIfState(resolved.serial, language, 'take_charger');
      } else {
        await showFailureAndReset(resolved, result.session, result.reason);
      }
    }
  }

  async function process(envelope) {
    const claimed = await claimEvent(db, envelope);
    if (!claimed) return;
    try {
      if (envelope.type === 'payter_card') await handleCard(envelope);
      else if (envelope.type === 'payter_ui') await handleUi(envelope);
      else if (envelope.type === 'payter_state') {
        const terminalState = terminalStateSchema.parse(envelope.payload);
        if (terminalState.online === true && String(terminalState.state || '').trim().toUpperCase() === 'IDLE') {
          await recoverIdleTerminal(terminalState.serialNumber, 'payter_state_webhook');
        }
      }
      else if (envelope.type === 'kiosk_event') await handleKioskEvent(envelope);
      await completeEvent(db, envelope.eventId);
    } catch (error) {
      await completeEvent(db, envelope.eventId, 'failed', error.message);
      throw error;
    }
  }

  return {activateTerminal, process, publishCommand, recoverIdleTerminal, retryFailedStart, showScreen};
}
