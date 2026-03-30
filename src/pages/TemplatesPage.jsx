import { useMemo, useState } from 'react';
import KioskDetailPanel from '../components/kiosk/KioskDetailPanel.jsx';

const previewClientInfo = {
  role: 'admin',
  username: 'chargerent',
  features: {
    rentals: false,
    details: true,
    stationid: true,
    address: true,
    status: true,
    pricing: true,
    reporting: false,
  },
  commands: {
    edit: false,
    lock: false,
    eject: false,
    eject_multiple: false,
    updates: false,
    connectivity: false,
    reboot: false,
    reload: false,
    disable: false,
    'client edit': false,
  },
};

function createSlot(position, overrides = {}) {
  const hasCharger = overrides.hasCharger ?? (position % 3 !== 0);
  const batteryLevel = hasCharger ? (overrides.batteryLevel ?? (position % 4 === 0 ? 72 : 100)) : null;
  const chargingCurrent = hasCharger ? (overrides.chargingCurrent ?? (position % 5 === 0 ? 12 : 0)) : 0;
  const isLocked = Boolean(overrides.isLocked);

  return {
    position,
    sn: hasCharger ? (overrides.sn ?? 40850000 + position) : 0,
    batteryLevel,
    chargingCurrent,
    isLocked,
    lockReason: isLocked ? 'Template lock' : '',
    cmos: null,
    sstat: hasCharger ? '0F' : '0C',
    isFullNotCharging: Boolean(hasCharger && batteryLevel >= 80 && chargingCurrent === 0),
    isSstatError: false,
    temperature: hasCharger ? 26 : 0,
    cellVoltage: hasCharger ? 224 : 0,
    cycle: position % 7,
    status: hasCharger ? 1 : 0,
  };
}

function createModule(id, startPosition, count, options = {}) {
  const slots = Array.from({ length: count }, (_, index) => {
    const position = startPosition + index;
    const isEmpty = options.emptyPositions?.includes(position) ?? false;
    const isLocked = options.lockedPositions?.includes(position) ?? false;
    return createSlot(position, {
      hasCharger: !isEmpty,
      isLocked,
      batteryLevel: options.batteryOverrides?.[position],
      chargingCurrent: options.chargingOverrides?.[position],
    });
  });

  return {
    id,
    lastUpdated: new Date().toISOString(),
    output: true,
    slots,
  };
}

function createRepeatingModule(id, count, options = {}) {
  const slots = Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const absolutePosition = (options.moduleIndex || 0) * count + position;
    const isEmpty = options.emptyPositions?.includes(position) ?? false;
    const isLocked = options.lockedPositions?.includes(position) ?? false;
    return createSlot(position, {
      hasCharger: !isEmpty,
      isLocked,
      batteryLevel: options.batteryOverrides?.[position] ?? (absolutePosition % 4 === 0 ? 72 : 100),
      chargingCurrent: options.chargingOverrides?.[position] ?? (absolutePosition % 5 === 0 ? 10 : 0),
      sn: !isEmpty ? 40850000 + absolutePosition : 0,
    });
  });

  return {
    id,
    lastUpdated: new Date().toISOString(),
    output: true,
    slots,
  };
}

function createTemplateKiosk(type) {
  const isNewSchema = ['CT3', 'CT4', 'CT8', 'CT12', 'CK48'].includes(type);
  const base = {
    stationid: `TPL-${type}`,
    provisionid: `template-${type.toLowerCase()}`,
    hardware: { type, power: 80, sn: `SN-${type}` },
    info: {
      location: 'Template Preview',
      place: type,
    },
    ui: {
      mode: 'template',
    },
    uistate: 'preview',
    timestamp: new Date().toISOString(),
    active: true,
    enabled: true,
    isNewSchema,
  };

  switch (type) {
    case 'CT3':
      return {
        ...base,
        modules: [
          createModule('ct3-m1', 1, 3, {
            emptyPositions: [2],
          }),
        ],
      };
    case 'CT4':
      return {
        ...base,
        modules: [
          createRepeatingModule('ct4-m1', 4, {
            moduleIndex: 0,
            emptyPositions: [2],
          }),
        ],
      };
    case 'CT8':
      return {
        ...base,
        modules: [
          createRepeatingModule('ct8-m1', 4, { moduleIndex: 0, emptyPositions: [2] }),
          createRepeatingModule('ct8-m2', 4, { moduleIndex: 1, emptyPositions: [3] }),
        ],
      };
    case 'CT10':
      return {
        ...base,
        modules: [
          createModule('ct10-m1', 1, 10, {
            emptyPositions: [2, 5, 8],
          }),
        ],
      };
    case 'CT12':
      return {
        ...base,
        modules: [
          createRepeatingModule('ct12-m1', 4, { moduleIndex: 0, emptyPositions: [2] }),
          createRepeatingModule('ct12-m2', 4, { moduleIndex: 1, emptyPositions: [3] }),
          createRepeatingModule('ct12-m3', 4, { moduleIndex: 2, emptyPositions: [4] }),
        ],
      };
    case 'CK20':
      return {
        ...base,
        modules: [
          createModule('ck20-m1', 1, 10, { emptyPositions: [2, 5, 9] }),
          createModule('ck20-m2', 11, 10, { emptyPositions: [12, 17, 20] }),
        ],
      };
    case 'CK30':
      return {
        ...base,
        modules: [
          createModule('ck30-m1', 1, 10, { emptyPositions: [2, 5, 8] }),
          createModule('ck30-m2', 11, 10, { emptyPositions: [13, 17, 19] }),
          createModule('ck30-m3', 21, 10, { emptyPositions: [22, 25, 28] }),
        ],
      };
    case 'CK48':
      return {
        ...base,
        modules: [
          {
            id: 'ck48-m1',
            lastUpdated: new Date().toISOString(),
            output: true,
            slots: Array.from({ length: 48 }, (_, index) => createSlot(index + 1, {
              hasCharger: (index + 1) % 3 !== 0,
              batteryLevel: (index + 1) % 4 === 0 ? 72 : 100,
              chargingCurrent: (index + 1) % 9 === 0 ? 10 : 0,
            })),
          },
        ],
      };
    case 'CK50':
      return {
        ...base,
        modules: [
          createModule('ck50-m1', 1, 10, { emptyPositions: [2, 6, 9] }),
          createModule('ck50-m2', 11, 10, { emptyPositions: [14, 17, 20] }),
          createModule('ck50-m3', 21, 10, { emptyPositions: [23, 27] }),
          createModule('ck50-m4', 31, 10, { emptyPositions: [32, 35, 40] }),
          createModule('ck50-m5', 41, 10, { emptyPositions: [42, 45, 49] }),
        ],
      };
    default:
      return base;
  }
}

const templateOptions = [
  { id: 'CT3', label: 'CT3' },
  { id: 'CT4', label: 'CT4' },
  { id: 'CT8', label: 'CT8' },
  { id: 'CT10', label: 'CT10' },
  { id: 'CT12', label: 'CT12' },
  { id: 'CK20', label: 'CK20' },
  { id: 'CK30', label: 'CK30' },
  { id: 'CK48', label: 'CK48' },
  { id: 'CK50', label: 'CK50' },
];

export default function TemplatesPage({ t, onLogout, onNavigateToAdmin, currentUser }) {
  const canViewTemplates = currentUser?.username === 'chargerent';
  const [selectedTemplate, setSelectedTemplate] = useState('CT3');

  const kiosksByTemplate = useMemo(() => (
    Object.fromEntries(templateOptions.map((template) => [template.id, createTemplateKiosk(template.id)]))
  ), []);

  const previewKiosk = kiosksByTemplate[selectedTemplate];

  if (!canViewTemplates) {
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('templates_page_title')}</h1>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onNavigateToAdmin} className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
                {t('back_to_admin')}
              </button>
              <button onClick={onLogout} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
                {t('logout')}
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
            {t('templates_access_denied')}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('templates_page_title')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('templates_page_subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onNavigateToAdmin} className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300">
              {t('back_to_admin')}
            </button>
            <button onClick={onLogout} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8">
        <aside className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500">{t('select_template')}</h2>
          <div className="mt-4 flex flex-col gap-2">
            {templateOptions.map((template) => {
              const isActive = template.id === selectedTemplate;
              return (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id)}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {template.label}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{selectedTemplate}</h2>
              <p className="text-sm text-gray-500">{t('template_preview')}</p>
            </div>
          </div>
          <KioskDetailPanel
            kiosk={previewKiosk}
            isVisible={true}
            onSlotClick={() => {}}
            onLockSlot={() => {}}
            pendingSlots={[]}
            ejectingSlots={[]}
            failedEjectSlots={[]}
            lockingSlots={[]}
            t={t}
            onCommand={() => {}}
            serverUiVersion={null}
            serverFlowVersion={null}
            clientInfo={previewClientInfo}
            mockNow={new Date()}
          />
        </section>
      </main>
    </div>
  );
}
