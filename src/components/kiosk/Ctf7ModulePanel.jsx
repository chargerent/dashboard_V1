function Ctf7ModulePanel({ modules = [] }) {
  return (
    <div className="space-y-4 p-4">
      {modules.map((module) => (
        <section key={module.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-900">CTF7 · 7 slots</h3>
              <p className="font-mono text-xs text-gray-600">{module.id}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Commissioning</span>
          </div>
          <p className="mb-3 text-xs text-gray-600">Label serial: {module.manufacturerSerial || 'Awaiting registration'} · Reported serial: {module.machineSN || 'Awaiting connection'}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(module.slots || []).map((slot) => (
              <div key={slot.position} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <span className="shrink-0 text-sm font-semibold">Slot {slot.position}</span>
                <div className="min-w-0 text-right">
                  <p className="break-all font-mono text-xs">{slot.observed !== true ? 'Awaiting inventory' : slot.sn || 'Empty'}</p>
                  {slot.sn && <p className="text-xs text-gray-500">{slot.batteryLevel == null ? 'SOC unavailable' : `${slot.batteryLevel}%`}{slot.abnormal ? ' · Device error' : ''}</p>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">{module.topologyVerified ? 'Slot mapping verified.' : 'Physical slot mapping needs verification.'} Rentals and motor controls are disabled during commissioning.</p>
        </section>
      ))}
    </div>
  );
}
export default Ctf7ModulePanel;
