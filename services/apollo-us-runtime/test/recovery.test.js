import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerminalRecoveryMonitor} from '../src/recovery.js';

class RegistryDb {
  constructor(registrations) {
    this.registrations = registrations;
  }

  collection(name) {
    assert.equal(name, 'apolloTerminalRegistry');
    return {
      where: (field, operator, value) => {
        assert.equal(field, 'environment');
        assert.equal(operator, '==');
        return {
          get: async () => ({
            docs: Object.entries(this.registrations)
              .filter(([, registration]) => registration.environment === value)
              .map(([id, registration]) => ({id, data: () => registration})),
          }),
        };
      },
    };
  }
}

test('terminal recovery reloads Start once at startup and after an offline-to-online transition', async () => {
  const db = new RegistryDb({
    APO20242802258: {
      terminalSerial: 'APO20242802258', environment: 'us-lab', enabled: true, gateway: 'APOLLO', scannerOnly: true,
    },
    DISABLED1: {
      terminalSerial: 'DISABLED1', environment: 'us-lab', enabled: false, gateway: 'APOLLO', scannerOnly: true,
    },
  });
  let terminal = {serialNumber: 'APO20242802258', online: true, state: 'IDLE'};
  const recoveries = [];
  const monitor = createTerminalRecoveryMonitor({
    config: {APOLLO_ENVIRONMENT: 'us-lab', TERMINAL_RECOVERY_POLL_MS: 3000},
    db,
    loadTerminal: async () => terminal,
    recoverTerminal: async (serial, trigger) => {
      recoveries.push({serial, trigger});
      return {recovered: true, trigger};
    },
    logger: {error() {}, info() {}},
    scheduleInterval: () => ({unref() {}}),
  });

  await monitor.start();
  assert.deepEqual(recoveries, [{serial: 'APO20242802258', trigger: 'runtime_startup'}]);

  await monitor.check();
  assert.equal(recoveries.length, 1);

  terminal = {...terminal, online: false};
  await monitor.check();
  assert.equal(recoveries.length, 1);

  terminal = {...terminal, online: true};
  await monitor.check();
  assert.deepEqual(recoveries.at(-1), {serial: 'APO20242802258', trigger: 'terminal_reconnected'});
});

test('terminal recovery ignores non-idle and non-scanner Apollo terminals', async () => {
  const db = new RegistryDb({
    APOBUSY: {environment: 'us-lab', enabled: true, gateway: 'APOLLO', scannerOnly: true},
    APOCARD: {environment: 'us-lab', enabled: true, gateway: 'APOLLO', scannerOnly: false},
  });
  const recoveries = [];
  const monitor = createTerminalRecoveryMonitor({
    config: {APOLLO_ENVIRONMENT: 'us-lab', TERMINAL_RECOVERY_POLL_MS: 3000},
    db,
    loadTerminal: async (serial) => ({serialNumber: serial, online: true, state: 'READING'}),
    recoverTerminal: async (...args) => recoveries.push(args),
    logger: {error() {}, info() {}},
    scheduleInterval: () => ({unref() {}}),
  });

  await monitor.start();
  assert.deepEqual(recoveries, []);
});

test('terminal recovery retries a failed Start post while Payter remains online and idle', async () => {
  const db = new RegistryDb({
    APO20242802258: {environment: 'us-lab', enabled: true, gateway: 'APOLLO', scannerOnly: true},
  });
  let retryCalls = 0;
  const monitor = createTerminalRecoveryMonitor({
    config: {APOLLO_ENVIRONMENT: 'us-lab', TERMINAL_RECOVERY_POLL_MS: 3000},
    db,
    loadTerminal: async () => ({serialNumber: 'APO20242802258', online: true, state: 'IDLE'}),
    recoverTerminal: async (_serial, trigger) => ({recovered: true, trigger}),
    retryFailedStart: async () => {
      retryCalls += 1;
      return {recovered: true, trigger: 'start_failure_retry'};
    },
    logger: {error() {}, info() {}},
    scheduleInterval: () => ({unref() {}}),
  });

  await monitor.start();
  assert.equal(retryCalls, 0);
  await monitor.check();
  assert.equal(retryCalls, 1);
});
