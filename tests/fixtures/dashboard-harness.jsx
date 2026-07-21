import { Profiler, StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DashboardPage from '../../src/pages/DashboardPage.jsx';
import { normalizeKioskData } from '../../src/utils/helpers.js';
import { translations } from '../../src/utils/translations.js';
import '../../src/index.css';
import './dashboard-harness.css';

const KIOSK_COUNT = 20;
const RENTAL_COUNT = 10_000;
const TARGET_STATION_ID = 'US9001';

const clientInfo = {
  uid: 'dashboard-resilience-user',
  username: 'chargerent',
  clientId: 'dashboard-resilience',
  role: 'admin',
  isAdmin: true,
  revShare: 10,
  features: {
    address: true,
    binding: true,
    client_commission: true,
    country: null,
    details: true,
    lease_revenue: false,
    media: true,
    pricing: true,
    rentals: true,
    rental_counts: true,
    rental_revenue: true,
    rep_commission: true,
    reporting: true,
    search: true,
    stationid: true,
    status: false,
    testing: true,
    ui_editor: true,
  },
  commands: {
    audio: false,
    binding: true,
    connectivity: true,
    disable: true,
    edit: false,
    eject: true,
    eject_multiple: true,
    lock: true,
    reboot: true,
    reload: true,
    updates: true,
  },
};

const makeRawKiosk = (index, timestamp) => {
  const stationid = `US${String(9001 + index).padStart(4, '0')}`;
  const locationNumber = Math.floor(index / 10) + 1;
  const slots = Array.from({ length: 30 }, (_, slotIndex) => ({
    position: slotIndex + 1,
    status: slotIndex % 4 === 0 ? 0 : 1,
    sn: slotIndex % 4 === 0 ? 0 : Number(`${9001 + index}${String(slotIndex + 1).padStart(2, '0')}`),
    batteryLevel: 15 + ((index * 7 + slotIndex * 11) % 80),
    chargingCurrent: slotIndex % 3 === 0 ? 650 : 0,
    chargingVoltage: 5,
    lock: slotIndex % 17 === 0,
    softwareVersion: 2,
  }));

  return {
    stationid,
    provisionid: `fixture-${stationid}`,
    active: true,
    status: 'provisioned',
    timestamp,
    count: slots.filter((slot) => slot.status === 1 && slot.batteryLevel >= 80 && !slot.lock).length,
    fversion: '478',
    hardware: {
      type: 'CK30',
      gateway: 'P68',
      sn: `FIXTURE-${stationid}`,
    },
    info: {
      location: `RESILIENCE TEST LOCATION ${locationNumber}`,
      place: `TEST STATION ${index + 1}`,
      address: `${100 + index} Test Avenue`,
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'US',
      client: 'dashboard-resilience',
      accountpercent: 10,
      rep: 'fixture-rep',
      reppercent: 5,
    },
    pricing: {
      kioskmode: 'PURCHASE',
      profile: 'MIXED DAILY',
      gatewayoption: 'FULLPRICE',
      symbol: '$',
      authamount: 30,
      initialprice: 5,
      initialperiod: 2,
      dailyprice: 10,
      buyprice: 30,
      buyperiod: 1,
    },
    ui: { mode: 'fixture', version: '120' },
    uistate: 'startpage',
    modules: {
      [`${stationid}m1`]: {
        id: `${stationid}m1`,
        output: true,
        heartbeatOutput: true,
        lastUpdated: timestamp,
        FW: 2,
        slots,
      },
    },
  };
};

const makeStations = () => {
  const timestamp = new Date().toISOString();
  return normalizeKioskData(
    Array.from({ length: KIOSK_COUNT }, (_, index) => makeRawKiosk(index, timestamp)),
  );
};

const makeRentals = (stations) => {
  const now = Date.now();
  return Array.from({ length: RENTAL_COUNT }, (_, index) => {
    const station = stations[index % stations.length];
    return {
      rawid: `fixture-rental-${index}`,
      orderid: `fixture-order-${index}`,
      rentalStationid: station.stationid,
      rentalTime: new Date(now - (index % 30) * 86_400_000 - (index % 1_000) * 1_000).toISOString(),
      status: index % 97 === 0 ? 'lost' : index % 11 === 0 ? 'rented' : 'returned',
      symbol: '$',
      totalCharged: 5 + (index % 4) * 5,
      initialCharge: 5,
      clientId: 'dashboard-resilience',
      repId: 'fixture-rep',
    };
  });
};

function DashboardHarness() {
  const seedStations = useMemo(() => makeStations(), []);
  const rentals = useMemo(() => makeRentals(seedStations), [seedStations]);
  const [stations, setStations] = useState(seedStations);
  const [kiosksReady, setKiosksReady] = useState(true);
  const [ngrokModalOpen, setNgrokModalOpen] = useState(false);
  const [commandStatus, setCommandStatus] = useState(null);
  const [churnIntervalMs, setChurnIntervalMs] = useState(0);

  const t = useCallback((key) => translations.en[key] || key, []);

  const pulseHeartbeat = useCallback(() => {
    const timestamp = new Date().toISOString();
    setStations((previous) => previous.map((station, stationIndex) => ({
      ...station,
      lastUpdated: timestamp,
      modules: station.modules.map((module, moduleIndex) => ({
        ...module,
        lastUpdated: timestamp,
        slots: module.slots.map((slot, slotIndex) => ({
          ...slot,
          batteryLevel: stationIndex === 0 && moduleIndex === 0 && slotIndex === 1
            ? Math.min(100, Number(slot.batteryLevel || 0) + 1)
            : slot.batteryLevel,
        })),
      })),
    })));
  }, []);

  useEffect(() => {
    if (!churnIntervalMs) return undefined;
    const timer = window.setInterval(pulseHeartbeat, churnIntervalMs);
    return () => window.clearInterval(timer);
  }, [churnIntervalMs, pulseHeartbeat]);

  useEffect(() => {
    window.__dashboardHarness = {
      disconnect() {
        setKiosksReady(false);
      },
      openCompetingModal() {
        setNgrokModalOpen(true);
      },
      pulseHeartbeat,
      recover() {
        setStations(seedStations);
        setKiosksReady(true);
      },
      startChurn(intervalMs = 50) {
        setChurnIntervalMs(intervalMs);
      },
      stopChurn() {
        setChurnIntervalMs(0);
      },
    };

    return () => {
      delete window.__dashboardHarness;
    };
  }, [pulseHeartbeat, seedStations]);

  const recordRender = useCallback((_id, _phase, actualDuration) => {
    const previous = window.__dashboardRenderMetrics || {
      commits: 0,
      maxActualDuration: 0,
      totalActualDuration: 0,
    };
    window.__dashboardRenderMetrics = {
      commits: previous.commits + 1,
      maxActualDuration: Math.max(previous.maxActualDuration, actualDuration),
      totalActualDuration: previous.totalActualDuration + actualDuration,
    };
  }, []);

  return (
    <Profiler id="dashboard-resilience" onRender={recordRender}>
      <DashboardPage
        onLogout={() => {}}
        clientInfo={clientInfo}
        t={t}
        language="en"
        setLanguage={() => {}}
        onNavigateToAdmin={() => {}}
        onNavigateToAiBooths={() => {}}
        onNavigateToBinding={() => {}}
        onNavigateToRentals={() => {}}
        onNavigateToChargers={() => {}}
        onNavigateToReporting={() => {}}
        onNavigateToTesting={() => {}}
        rentalData={rentals}
        allStationsData={stations}
        onCommand={() => {}}
        commandStatus={commandStatus}
        setCommandStatus={setCommandStatus}
        firestoreError={null}
        initialStatusCheck={true}
        setInitialStatusCheck={() => {}}
        serverFlowVersion="496"
        serverUiVersion="130"
        pendingSlots={[]}
        ejectingSlots={[]}
        setEjectingSlots={() => {}}
        failedEjectSlots={[]}
        lockingSlots={[]}
        ngrokModalOpen={ngrokModalOpen}
        setNgrokModalOpen={setNgrokModalOpen}
        ngrokInfo={{ kioskId: TARGET_STATION_ID, message: 'Fixture ngrok connection' }}
        manageIgnoredKiosk={() => {}}
        kiosksReady={kiosksReady}
      />
    </Profiler>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DashboardHarness />
  </StrictMode>,
);
