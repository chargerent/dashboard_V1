import { useEffect } from 'react';
import { ArrowPathIcon, CameraIcon, XMarkIcon } from '@heroicons/react/24/outline';

function formatCapturedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleString();
}

export default function KioskScreenshotModal({
  screenshot,
  onClose,
  onRefresh,
  onImageLoad,
  onImageError,
  t,
}) {
  const isOpen = screenshot?.isOpen === true;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isWaiting = screenshot.state === 'requesting' || screenshot.state === 'received';
  const capturedAt = formatCapturedAt(screenshot.capturedAt);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-screenshot-title"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-cyan-100 p-2 text-cyan-700">
              <CameraIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="kiosk-screenshot-title" className="truncate text-lg font-semibold text-gray-900">
                {t('display_screenshot')} · {screenshot.stationid}
              </h2>
              {capturedAt && (
                <p className="text-xs text-gray-500">{t('captured_at')}: {capturedAt}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label={t('close')}
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="relative flex min-h-72 flex-1 items-center justify-center overflow-auto bg-slate-950 p-4">
          {screenshot.imageUrl && (
            <img
              src={screenshot.imageUrl}
              alt={`${screenshot.stationid} ${t('display_screenshot')}`}
              className="max-h-[70vh] max-w-full rounded-md object-contain shadow-lg"
              onLoad={onImageLoad}
              onError={onImageError}
            />
          )}

          {isWaiting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 text-white">
              <ArrowPathIcon className="h-9 w-9 animate-spin" />
              <p className="text-sm font-medium">{t('capturing_screen')}</p>
            </div>
          )}

          {screenshot.state === 'error' && (
            <div className="max-w-lg rounded-xl border border-red-400/40 bg-red-950/60 px-6 py-5 text-center text-red-100">
              <p className="font-semibold">{t('screenshot_failed')}</p>
              <p className="mt-2 text-sm text-red-200">{screenshot.error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('close')}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isWaiting}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-cyan-300"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isWaiting ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </button>
        </div>
      </div>
    </div>
  );
}
