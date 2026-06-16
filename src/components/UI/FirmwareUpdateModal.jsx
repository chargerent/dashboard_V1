import { useEffect, useMemo, useState } from 'react';
import { callFunctionWithAuth } from '../../utils/callableRequest';

const FIRMWARE_TARGETS = [
  { value: '12B', label: '12B' },
  { value: '12M', label: '12M' },
  { value: 'mcu', label: 'MCU' },
];

function getLabel(t, key, fallback) {
  const translated = typeof t === 'function' ? t(key) : '';
  return translated && translated !== key ? translated : fallback;
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function inferVersion(fileName) {
  const match = String(fileName || '').match(/(?:^|[-_vV])(\d+(?:\.\d+){1,4})(?:[-_.]|$)/);
  return match ? match[1] : '';
}

function uploadFileWithProgress({ uploadUrl, file, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', contentType);

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / (event.total || file.size || 1)) * 100));
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }

      reject(new Error(`Upload failed (${request.status})`));
    });

    request.addEventListener('error', () => reject(new Error('Upload failed.')));
    request.addEventListener('abort', () => reject(new Error('Upload canceled.')));
    request.send(file);
  });
}

export default function FirmwareUpdateModal({
  isOpen,
  details,
  onClose,
  onFirmwareReady,
  setCommandStatus,
  t,
}) {
  const [target, setTarget] = useState('12B');
  const [file, setFile] = useState(null);
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const labels = useMemo(() => ({
    title: getLabel(t, 'firmware_update_title', 'Upload Firmware'),
    target: getLabel(t, 'firmware_target', 'Firmware target'),
    file: getLabel(t, 'firmware_file', 'Firmware file'),
    version: getLabel(t, 'firmware_version', 'Version'),
    versionPlaceholder: getLabel(t, 'firmware_version_placeholder', 'Optional, inferred from filename'),
    choose: getLabel(t, 'firmware_choose_file', 'Choose .bin or .pac'),
    cancel: getLabel(t, 'cancel', 'Cancel'),
    uploadAndUpdate: getLabel(t, 'firmware_upload_and_update', 'Upload and Update'),
    uploading: getLabel(t, 'firmware_uploading', 'Uploading firmware...'),
    finalizing: getLabel(t, 'firmware_finalizing', 'Finalizing release...'),
    helper: getLabel(t, 'firmware_modal_helper', 'The selected file becomes the active firmware for this target before the module update is triggered.'),
  }), [t]);

  useEffect(() => {
    if (!isOpen) return;
    setTarget('12B');
    setFile(null);
    setVersion('');
    setProgress(0);
    setStatus('idle');
    setErrorMessage('');
  }, [isOpen]);

  const isBusy = status === 'preparing' || status === 'uploading' || status === 'finalizing';
  const canSubmit = Boolean(file) && !isBusy;

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setErrorMessage('');
    if (nextFile && !version) {
      setVersion(inferVersion(nextFile.name));
    }
  };

  const handleSubmit = async () => {
    if (!file || isBusy) return;

    const contentType = file.type || 'application/octet-stream';
    setErrorMessage('');
    setProgress(0);
    setStatus('preparing');
    setCommandStatus?.({ state: 'sending', message: labels.uploading });

    try {
      const uploadConfig = await callFunctionWithAuth('firmware_createUploadUrl', {
        target,
        fileName: file.name,
        contentType,
        size: file.size,
      }, {
        timeoutMs: 30000,
        timeoutMessage: 'Preparing firmware upload took too long.',
      });

      setStatus('uploading');
      await uploadFileWithProgress({
        uploadUrl: uploadConfig.uploadUrl,
        file,
        contentType,
        onProgress: setProgress,
      });

      setStatus('finalizing');
      setCommandStatus?.({ state: 'sending', message: labels.finalizing });
      const finalizePayload = await callFunctionWithAuth('firmware_finalizeUpload', {
        releaseId: uploadConfig.releaseId,
        target: uploadConfig.target || target,
        fileName: file.name,
        storagePath: uploadConfig.storagePath,
        bucketName: uploadConfig.bucketName,
        contentType,
        size: file.size,
        version,
        activate: true,
      }, {
        timeoutMs: 30000,
        timeoutMessage: 'Finalizing firmware upload took too long.',
      });

      setStatus('complete');
      setCommandStatus?.({ state: 'sending', message: getLabel(t, 'sending_command', 'Sending command...') });
      onFirmwareReady?.({
        target: uploadConfig.target || target,
        fileName: file.name,
        size: file.size,
        version,
        release: finalizePayload?.release || null,
      });
      onClose?.();
    } catch (error) {
      const message = error?.message || 'Firmware upload failed.';
      setErrorMessage(message);
      setStatus('error');
      setCommandStatus?.({ state: 'error', message });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-gray-900">{labels.title}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {details?.stationid} / {details?.moduleid}
          </p>
          <p className="mt-2 text-xs text-gray-500">{labels.helper}</p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-gray-700">{labels.target}</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={isBusy}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            >
              {FIRMWARE_TARGETS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-gray-700">{labels.file}</span>
            <input
              type="file"
              accept=".bin,.pac"
              onChange={handleFileChange}
              disabled={isBusy}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-gray-700 disabled:bg-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500">
              {file ? `${file.name} - ${formatBytes(file.size)}` : labels.choose}
            </p>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-gray-700">{labels.version}</span>
            <input
              type="text"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              disabled={isBusy}
              placeholder={labels.versionPlaceholder}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </label>

          {isBusy && (
            <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-blue-800">
                <span>{status === 'finalizing' ? labels.finalizing : labels.uploading}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-md bg-gray-200 px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {labels.uploadAndUpdate}
          </button>
        </div>
      </div>
    </div>
  );
}
