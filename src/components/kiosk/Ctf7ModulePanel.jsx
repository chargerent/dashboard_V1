function Ctf7ModulePanel({ modules = [], renderSlot, renderModuleActions }) {
  return (
    <div className="w-full space-y-4">
      {modules.map((module) => (
        <section key={module.id} aria-label={`Module ${module.id}`} data-kiosk-moduleid={module.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-4 gap-2" aria-label="CTF7 physical layout: three upper slots, rental QR panel, four lower slots">
            {Array.from({ length: 8 }, (_, cell) => {
              if (cell === 3) {
                return <div key="qr-panel" className="flex min-h-28 min-w-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-100 p-2 text-center">
                  <svg viewBox="0 0 40 40" className="h-10 w-10 text-gray-500" aria-hidden="true">
                    <path fill="currentColor" fillRule="evenodd" d="M2 2h14v14H2V2Zm3 3v8h8V5H5Zm3 3h2v2H8V8ZM24 2h14v14H24V2Zm3 3v8h8V5h-8Zm3 3h2v2h-2V8ZM2 24h14v14H2V24Zm3 3v8h8v-8H5Zm3 3h2v2H8v-2Z" />
                  </svg>
                  <span className="text-xs font-semibold text-gray-600">Rental QR</span>
                </div>;
              }
              const position = cell < 3 ? cell + 1 : cell;
              const slot = (module.slots || []).find((item) => item.position === position) || { position };
              if (renderSlot) return renderSlot(module, slot);
              const occupied = slot.observed === true && Boolean(slot.sn);
              return <div key={position} className={`flex min-h-28 min-w-0 flex-col gap-2 rounded-md border p-2 sm:p-3 ${occupied ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <span className="text-sm font-semibold text-gray-900">Slot {position}</span>
                <p className="break-all font-mono text-xs text-gray-700">{slot.observed !== true ? 'Awaiting inventory' : slot.sn || 'Empty'}</p>
                {occupied && <p className="mt-auto text-xs text-gray-600">{slot.batteryLevel == null ? 'SOC unavailable' : `${slot.batteryLevel}%`}{slot.abnormal ? ' · Device error' : ''}</p>}
              </div>;
            })}
          </div>
          {renderModuleActions?.(module)}
        </section>
      ))}
    </div>
  );
}
export default Ctf7ModulePanel;
