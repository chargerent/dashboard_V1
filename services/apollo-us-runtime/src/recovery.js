import {normalizeSerial} from './contracts.js';

const normalizeTerminalState = (value) => String(value || '').trim().toUpperCase();

export function createTerminalRecoveryMonitor({
  config,
  db,
  loadTerminal,
  recoverTerminal,
  retryFailedStart,
  logger = console,
  scheduleInterval = setInterval,
  cancelInterval = clearInterval,
}) {
  const observations = new Map();
  let checking = false;
  let intervalHandle;

  async function checkTerminal(doc) {
    const registration = doc.data() || {};
    if (
      registration.enabled !== true
      || registration.scannerOnly !== true
      || String(registration.gateway || '').trim().toUpperCase() !== 'APOLLO'
    ) return;

    const serial = normalizeSerial(registration.terminalSerial || doc.id);
    try {
      const terminal = await loadTerminal(serial);
      const online = terminal.online === true;
      const state = normalizeTerminalState(terminal.state);
      const previous = observations.get(serial);
      const needsRecovery = online && state === 'IDLE' && (
        previous === undefined
        || previous.online === false
        || previous.recoveryPending === true
      );
      observations.set(serial, {online, recoveryPending: false, state});
      if (!needsRecovery) {
        if (online && state === 'IDLE' && retryFailedStart) {
          const retried = await retryFailedStart(serial);
          if (retried?.recovered) {
            logger.info(JSON.stringify({event: 'apollo_start_screen_recovered', serialNumber: serial, trigger: retried.trigger}));
          }
        }
        return;
      }

      try {
        const result = await recoverTerminal(serial, previous === undefined ? 'runtime_startup' : 'terminal_reconnected');
        if (result?.recovered) {
          logger.info(JSON.stringify({event: 'apollo_start_screen_recovered', serialNumber: serial, trigger: result.trigger}));
        }
      } catch (error) {
        observations.set(serial, {online, recoveryPending: true, state});
        throw error;
      }
    } catch (error) {
      logger.error(JSON.stringify({event: 'apollo_terminal_recovery_failed', message: error.message, serialNumber: serial}));
    }
  }

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const snapshot = await db.collection('apolloTerminalRegistry')
        .where('environment', '==', config.APOLLO_ENVIRONMENT)
        .get();
      for (const doc of snapshot.docs) await checkTerminal(doc);
    } catch (error) {
      logger.error(JSON.stringify({event: 'apollo_terminal_recovery_scan_failed', message: error.message}));
    } finally {
      checking = false;
    }
  }

  async function start() {
    if (intervalHandle) return;
    await check();
    intervalHandle = scheduleInterval(() => void check(), config.TERMINAL_RECOVERY_POLL_MS);
    intervalHandle?.unref?.();
  }

  function stop() {
    if (!intervalHandle) return;
    cancelInterval(intervalHandle);
    intervalHandle = undefined;
  }

  return {check, start, stop};
}
