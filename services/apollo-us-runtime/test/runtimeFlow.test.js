import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime} from '../src/runtime.js';

class MemoryDb {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  collection(name) {
    const query = (filters = [], limitValue = Infinity) => ({
      where: (field, operator, value) => {
        assert.equal(operator, '==');
        return query([...filters, {field, value}], limitValue);
      },
      limit: (value) => query(filters, value),
      get: async () => {
        const prefix = `${name}/`;
        const docs = [...this.values.entries()]
          .filter(([path, value]) => path.startsWith(prefix) && filters.every((filter) => value?.[filter.field] === filter.value))
          .slice(0, limitValue)
          .map(([path, value]) => ({id: path.slice(prefix.length), data: () => value}));
        return {docs, empty: docs.length === 0, size: docs.length};
      },
    });
    return {
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          id,
          path,
          get: async () => this.snapshot(path),
          set: async (value, options = {}) => this.set(path, value, options),
        };
      },
      where: query().where,
    };
  }

  snapshot(path) {
    return {exists: this.values.has(path), data: () => this.values.get(path)};
  }

  set(path, value, options = {}) {
    this.values.set(path, options.merge ? {...(this.values.get(path) || {}), ...value} : {...value});
  }

  async runTransaction(handler) {
    return handler({
      get: async (ref) => this.snapshot(ref.path),
      create: (ref, value) => {
        if (this.values.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
        this.values.set(ref.path, {...value});
      },
      set: (ref, value, options = {}) => this.set(ref.path, value, options),
      update: (ref, value) => {
        if (!this.values.has(ref.path)) throw new Error(`Document does not exist: ${ref.path}`);
        this.values.set(ref.path, {...this.values.get(ref.path), ...value});
      },
    });
  }
}

const release = {
  schemaVersion: 1,
  profileId: 'smpl-apollo',
  clientId: 'SMPL',
  profileVersion: 1,
  sectionVersion: 1,
  environment: 'us-lab',
  content: {
    translations: {
      en: {
        startpage: {title: 'Welcome', subtitle: 'Press Start', startbutton: 'Start'},
        availabilitypage: {title: 'Please wait', subtitle: 'Checking availability'},
        ejectpage: {title: 'Please wait', subtitle: 'Dispensing charger'},
        thankyoupage: {title: 'Take your charger', message: 'Remove it from the kiosk'},
        soldoutpage: {title: 'Sold out', subtitle: 'No available chargers'},
        canceledpage: {title: 'Unable to continue', subtitle: 'Try again'},
        nocardpage: {title: 'No QR scanned', subtitle: 'Please try again'},
        returntypage: {title: 'Thank you', message: 'Accepted', modulelabel: 'Module', slotlabel: 'Slot'},
      },
    },
    screenFlow: {version: 1, entryScreenId: '', screens: [], removedEstablishedScreenIds: []},
    qr: {enabled: true, provider: 'chargerent-issued', promptTitle: 'Borrow a charger', promptMessage: 'Scan your QR code'},
  },
};

const envelope = (eventId, type, payload) => ({schemaVersion: 1, eventId, type, payload, receivedAt: '2026-09-10T12:00:00.000Z'});

test('an idle Payter state callback atomically reloads the Start screen after a terminal reconnect', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
    'apolloTerminalRuntime/APO20242802258': {state: 'idle', activeScreenId: 'start-before-reboot', language: 'en'},
  });
  const payterRequests = [];
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example',
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => 'after-reboot',
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      payterRequests.push(request.options.body ? JSON.parse(request.options.body) : null);
      return {status: 200, body: ''};
    },
  });

  await runtime.process(envelope('payter-state-reconnected', 'payter_state', {
    serialNumber: 'APO20242802258', online: true, state: 'IDLE',
  }));

  assert.equal(payterRequests.at(-1).id, 'start-after-reboot');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').activeScreenId, 'start-after-reboot');
});

test('runtime startup recovers a completed take-charger state whose reset timer was lost', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
    'apolloTerminalRuntime/APO20242802258': {
      state: 'take_charger', activeSessionId: 'completed-session', readerSessionId: 'old-reader', language: 'en',
    },
  });
  const payterRequests = [];
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example',
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => 'startup-reset',
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      payterRequests.push(request.options.body ? JSON.parse(request.options.body) : null);
      return {status: 200, body: ''};
    },
  });

  const recovered = await runtime.recoverIdleTerminal('APO20242802258', 'runtime_startup');
  assert.equal(recovered.recovered, true);
  assert.equal(payterRequests.at(-1).id, 'start-startup-reset');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').activeSessionId, '');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').readerSessionId, '');
});

test('Apollo scanner flow checks inventory before scanning, vends, shows dispense, and returns to Start', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
  });
  const payterRequests = [];
  const mqttCommands = [];
  const sleepCalls = [];
  const ids = ['initial', 'reader', 'take', 'returned'];
  const config = {
    APOLLO_ENVIRONMENT: 'us-lab', AVAILABILITY_MIN_DISPLAY_MS: 0, CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
    PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', QR_HASH_SECRET: 'qr-secret',
    QR_READER_TIMEOUT_MS: 45000,
    QR_READER_STATE_ATTEMPTS: 2, QR_READER_STATE_POLL_MS: 100,
    SCREEN_RETURN_DELAY_MS: 0,
  };
  const runtime = createRuntime({
    config,
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async (_topic, payload) => mqttCommands.push(JSON.parse(payload))},
    payterCall: async (request) => {
      payterRequests.push({body: request.options.body ? JSON.parse(request.options.body) : null, method: request.options.method, path: request.url.pathname});
      if (request.options.method === 'GET') return {status: 200, body: JSON.stringify({online: true, state: 'READING'})};
      return {status: 200, body: ''};
    },
    sleep: async (milliseconds) => sleepCalls.push(milliseconds),
  });

  const activated = await runtime.activateTerminal('APO20242802258', 'en');
  assert.equal(activated.screenId, 'start-initial');
  const startRequest = payterRequests.find(({body}) => body?.id === 'start-initial');
  assert.equal(startRequest.body.type, 'carousel');
  assert.equal(startRequest.body.properties.subtitle, 'Press Start');
  assert.equal(Object.hasOwn(startRequest.body.properties, 'message'), false);
  assert.equal(startRequest.body.properties['buttons.start.label'], 'Start');
  assert.equal(startRequest.body.properties['buttons.lang.language'], 'true');
  assert.equal(startRequest.body.properties['cards.0.logo'], 'mastercard');

  await runtime.process(envelope('ui-event-0001', 'payter_ui', {
    serialNumber: 'APO20242802258', screenId: 'start-initial', response: 'start',
  }));
  assert.equal(mqttCommands.length, 1);
  assert.equal(mqttCommands[0].action, 'status');
  assert.equal(payterRequests.some(({path}) => path.endsWith('/start')), false);

  await runtime.process(envelope('status-event-0001', 'kiosk_event', {
    schemaVersion: 1, type: 'availability_result', sessionId: 'ui-event-0001', commandId: 'availability:ui-event-0001',
    available: true, module: 'M1', slot: 2, chargerId: '41807101',
  }));
  assert.equal(payterRequests.some(({path}) => path === '/terminals/APO20242802258/start'), true);
  assert.equal(payterRequests.some(({method, path}) => method === 'GET' && path === '/terminals/APO20242802258'), true);
  const availabilityRequest = payterRequests.find(({body}) => body?.id?.startsWith('availability-'));
  assert.equal(availabilityRequest.body.type, 'info');
  assert.deepEqual(availabilityRequest.body.properties, {title: 'Please wait', subtitle: 'Checking availability'});
  assert.equal(sleepCalls.includes(1500), false);
  const terminalRuntime = db.values.get('apolloTerminalRuntime/APO20242802258');
  assert.equal(terminalRuntime.readerSessionId, 'reader');

  const rawCredential = 'arbitrary-library-card-for-lab';
  await runtime.process(envelope('card-event-0001', 'payter_card', {
    // Payter's Apollo test firmware can report a generic interface for a
    // successful camera read. The explicit lab-only any-QR mode accepts it.
    serialNumber: 'APO20242802258', ifd: 'UNKNOWN', aid: '', cardId: rawCredential, readerSessionId: 'reader',
  }));
  assert.equal(payterRequests.some(({path}) => path.endsWith('/stop')), true);
  assert.equal(mqttCommands.length, 2);
  assert.equal(mqttCommands[1].action, 'vend');
  assert.equal(mqttCommands[1].stationid, 'US8004');
  assert.equal(mqttCommands[1].gateway, 'SCANNER');
  assert.equal(mqttCommands[1].terminalGateway, 'APOLLO');
  assert.equal(mqttCommands[1].credentialProvider, 'test-any');
  assert.equal(JSON.stringify([...db.values.values()]).includes(rawCredential), false);
  const dispensingRequest = payterRequests.find(({body}) => body?.id?.startsWith('dispensing-'));
  assert.equal(dispensingRequest.body.type, 'info');
  assert.deepEqual(dispensingRequest.body.properties, {title: 'Please wait', subtitle: 'Dispensing charger'});

  await runtime.process(envelope('vend-event-0001', 'kiosk_event', {
    schemaVersion: 1, type: 'vend_result', sessionId: 'ui-event-0001', commandId: 'vend:ui-event-0001',
    success: true, module: 'M1', slot: 2, chargerId: '41807101',
  }));
  const uiBodies = payterRequests.filter(({body}) => body).map(({body}) => body);
  assert.equal(uiBodies.some(({type, properties}) => type === 'dispense' && properties.title === 'Take your charger'), true);
  assert.equal(uiBodies.at(-1).id, 'start-returned');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
  assert.equal(db.values.get('apolloLabRentals/ui-event-0001').status, 'dispensed');
});

test('a failed Payter notice cannot strand the terminal away from Start', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
  });
  const payterRequests = [];
  const ids = ['initial', 'failed-notice', 'reset'];
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', AVAILABILITY_MIN_DISPLAY_MS: 0, CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', SCREEN_RETURN_DELAY_MS: 7000,
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      const body = request.options.body ? JSON.parse(request.options.body) : null;
      payterRequests.push(body);
      if (body?.id === 'failure-failed-notice') throw new Error('Payter request timed out');
      return {status: 200, body: ''};
    },
    sleep: async () => {},
  });

  const activated = await runtime.activateTerminal('APO20242802258', 'en');
  await runtime.process(envelope('ui-event-unavailable', 'payter_ui', {
    serialNumber: 'APO20242802258', screenId: activated.screenId, response: 'start',
  }));
  await runtime.process(envelope('status-event-unavailable', 'kiosk_event', {
    schemaVersion: 1, type: 'availability_result', sessionId: 'ui-event-unavailable', commandId: 'availability:ui-event-unavailable',
    available: false,
  }));

  assert.equal(payterRequests.at(-1).id, 'start-reset');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
});

test('a successful V2 return shows the assigned Apollo return-complete screen and returns to Start', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
  });
  const payterRequests = [];
  const sleepCalls = [];
  const ids = ['initial', 'return-screen', 'returned'];
  const config = {
    APOLLO_ENVIRONMENT: 'us-lab', AVAILABILITY_MIN_DISPLAY_MS: 0, CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
    PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', QR_HASH_SECRET: 'qr-secret',
    QR_READER_TIMEOUT_MS: 45000, QR_READER_STATE_ATTEMPTS: 2, QR_READER_STATE_POLL_MS: 100,
    SCREEN_RETURN_DELAY_MS: 7000,
  };
  const runtime = createRuntime({
    config,
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      payterRequests.push({body: request.options.body ? JSON.parse(request.options.body) : null, method: request.options.method, path: request.url.pathname});
      return {status: 200, body: ''};
    },
    sleep: async (milliseconds) => sleepCalls.push(milliseconds),
  });

  await runtime.activateTerminal('APO20242802258', 'en');
  await runtime.process(envelope('return-event-0001', 'kiosk_event', {
    schemaVersion: 1, type: 'return_result', stationId: 'US8004', success: true,
    module: 'M1', slot: 3, chargerId: '41807101', returnedAt: 123,
  }));

  const returnRequest = payterRequests.find(({body}) => body?.id === 'return-return-screen');
  assert.equal(returnRequest.body.type, 'info');
  assert.deepEqual(returnRequest.body.properties, {title: 'Return accepted', subtitle: ''});
  assert.equal(JSON.stringify(returnRequest.body.properties).includes('Module'), false);
  assert.equal(JSON.stringify(returnRequest.body.properties).includes('Slot'), false);
  assert.deepEqual(sleepCalls, [7000]);
  assert.equal(payterRequests.at(-1).body.id, 'start-returned');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
});

test('a physical return never interrupts an active Apollo customer session', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
    'apolloTerminalRuntime/APO20242802258': {state: 'reading', language: 'en'},
  });
  const payterRequests = [];
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', SCREEN_RETURN_DELAY_MS: 7000,
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      payterRequests.push(request);
      return {status: 200, body: ''};
    },
    sleep: async () => {},
  });

  await runtime.process(envelope('return-event-busy', 'kiosk_event', {
    schemaVersion: 1, type: 'return_result', stationId: 'US8004', success: true,
    module: 'M1', slot: 3, chargerId: '41807101', returnedAt: 124,
  }));
  assert.equal(payterRequests.length, 0);
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'reading');
});

test('a return may replace the completed take-charger screen', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
    'apolloTerminalRuntime/APO20242802258': {state: 'take_charger', language: 'en'},
  });
  const payterRequests = [];
  const ids = ['return-screen', 'returned'];
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', SCREEN_RETURN_DELAY_MS: 7000,
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      payterRequests.push({body: request.options.body ? JSON.parse(request.options.body) : null});
      return {status: 200, body: ''};
    },
    sleep: async () => {},
  });

  await runtime.process(envelope('return-event-after-vend', 'kiosk_event', {
    schemaVersion: 1, type: 'return_result', stationId: 'US8004', success: true,
    module: 'M1', slot: 3, chargerId: '41807101', returnedAt: 125,
  }));
  assert.equal(payterRequests[0].body.id, 'return-return-screen');
  assert.equal(payterRequests.at(-1).body.id, 'start-returned');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
});

test('a failed return-to-Start post becomes retryable instead of remaining in a transition state', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
    'apolloTerminalRuntime/APO20242802258': {state: 'idle', language: 'en'},
  });
  const ids = ['return-screen', 'failed-start', 'recovered-start'];
  let failNextStart = true;
  const runtime = createRuntime({
    config: {
      APOLLO_ENVIRONMENT: 'us-lab', CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
      PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', SCREEN_RETURN_DELAY_MS: 7000,
    },
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async () => {}},
    payterCall: async (request) => {
      const body = request.options.body ? JSON.parse(request.options.body) : null;
      if (failNextStart && body?.id === 'start-failed-start') {
        failNextStart = false;
        throw new Error('Payter CPS returned HTTP 500');
      }
      return {status: 200, body: ''};
    },
    sleep: async () => {},
  });

  await assert.rejects(runtime.process(envelope('return-event-start-failure', 'kiosk_event', {
    schemaVersion: 1, type: 'return_result', stationId: 'US8004', success: true,
    module: 'M1', slot: 3, chargerId: '41807101', returnedAt: 126,
  })), /HTTP 500/);
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'start_failed');

  const retried = await runtime.retryFailedStart('APO20242802258');
  assert.equal(retried.recovered, true);
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').activeScreenId, 'start-recovered-start');
});

test('Apollo QR timeout shows a QR-specific notice, closes the session, and never vends', async () => {
  const db = new MemoryDb({
    'apolloTerminalRegistry/APO20242802258': {
      environment: 'us-lab', enabled: true, gateway: 'APOLLO', clientId: 'SMPL', stationId: 'US8004',
      scannerOnly: true, acceptAnyQr: true,
    },
    'apolloClientAssignments/SMPL': {environment: 'us-lab', enabled: true, releaseId: 'smpl-v1'},
    'apolloProfileReleases/smpl-v1': release,
  });
  const payterRequests = [];
  const mqttCommands = [];
  const ids = ['initial', 'reader', 'timeout-screen', 'returned'];
  let timeoutCallback;
  let timeoutDelay;
  const config = {
    APOLLO_ENVIRONMENT: 'us-lab', AVAILABILITY_MIN_DISPLAY_MS: 0, CALLBACK_TOKEN_SECRET: 'callback-secret', CPS_ENVIRONMENT: 'test',
    PAYTER_API_KEY_SECRET: 'api-secret', PUBLIC_BASE_URL: 'https://apollo.example', QR_HASH_SECRET: 'qr-secret',
    QR_READER_TIMEOUT_MS: 45000, QR_READER_STATE_ATTEMPTS: 2, QR_READER_STATE_POLL_MS: 100,
    SCREEN_RETURN_DELAY_MS: 0,
  };
  const runtime = createRuntime({
    config,
    db,
    loadSecret: async (name) => `${name}-value`,
    makeId: () => ids.shift(),
    mqttClient: {publishAsync: async (_topic, payload) => mqttCommands.push(JSON.parse(payload))},
    payterCall: async (request) => {
      payterRequests.push({body: request.options.body ? JSON.parse(request.options.body) : null, method: request.options.method, path: request.url.pathname});
      if (request.options.method === 'GET') return {status: 200, body: JSON.stringify({online: true, state: 'READING'})};
      return {status: 200, body: ''};
    },
    scheduleTimeout: (callback, delay) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return {unref() {}};
    },
    cancelTimeout: () => {},
    sleep: async () => {},
  });

  const activated = await runtime.activateTerminal('APO20242802258', 'en');
  await runtime.process(envelope('ui-event-timeout', 'payter_ui', {
    serialNumber: 'APO20242802258', screenId: activated.screenId, response: 'ok',
  }));
  await runtime.process(envelope('status-event-timeout', 'kiosk_event', {
    schemaVersion: 1, type: 'availability_result', sessionId: 'ui-event-timeout', commandId: 'availability:ui-event-timeout',
    available: true, module: 'M1', slot: 2, chargerId: '41807101',
  }));

  assert.equal(timeoutDelay, 45000);
  await timeoutCallback();
  assert.equal(db.values.get('apolloVendSessions/ui-event-timeout').state, 'failed');
  assert.equal(db.values.get('apolloVendSessions/ui-event-timeout').failureReason, 'qr_timeout');
  assert.equal(db.values.get('apolloTerminalRuntime/APO20242802258').state, 'idle');
  assert.equal(mqttCommands.some(({action}) => action === 'vend'), false);
  assert.equal(payterRequests.some(({path}) => path.endsWith('/stop')), true);
  assert.equal(payterRequests.some(({body}) => body?.properties?.title === 'No QR scanned'), true);
});
