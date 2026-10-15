import { useEffect, useId, useRef, useState } from 'react';
import { RECEIPT_LOGO_ACCEPT, receiptLogoFileError, receiptLogoPreviewUrl } from '../utils/receiptLogo.js';

export default function ReceiptLogoField({ value, file, onFileChange, onRemove, disabled = false, onCheckingChange }) {
  const inputId = useId();
  const selectionVersion = useRef(0);
  const [localPreview, setLocalPreview] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!file) {
      setLocalPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => { selectionVersion.current += 1; onCheckingChange?.(false); }, [onCheckingChange]);
  useEffect(() => { onCheckingChange?.(checking); }, [checking, onCheckingChange]);

  const preview = localPreview || receiptLogoPreviewUrl(value);
  const selectFile = async (event) => {
    const candidate = event.target.files?.[0];
    event.target.value = '';
    if (!candidate) return;
    const version = ++selectionVersion.current;
    const validationError = receiptLogoFileError(candidate);
    setError(validationError);
    if (validationError) return;
    setChecking(true);
    const url = URL.createObjectURL(candidate);
    try {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The image could not be opened. Choose a valid PNG, JPEG, or WebP logo.'));
      });
      image.src = url;
      await loaded;
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('The logo must be 4096 pixels or smaller on each side.');
      if (version === selectionVersion.current) onFileChange(candidate);
    } catch (failure) {
      if (version === selectionVersion.current) setError(failure.message);
    } finally {
      URL.revokeObjectURL(url);
      if (version === selectionVersion.current) setChecking(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">Receipt logo</label>
      <p className="mt-1 text-xs text-gray-500">Shown at the top of this client’s rental receipts. PNG, JPEG, or WebP, up to 2 MB.</p>
      {preview && <div className="mt-3 flex h-24 items-center justify-center rounded-md border border-gray-200 bg-white p-3"><img src={preview} alt="Receipt logo preview" className="max-h-full max-w-full object-contain" /></div>}
      <input id={inputId} type="file" accept={RECEIPT_LOGO_ACCEPT} disabled={disabled || checking} onChange={selectFile}
        className="mt-3 block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold file:text-blue-700 disabled:opacity-50" />
      {checking && <p className="mt-2 text-xs text-gray-500" role="status">Checking image…</p>}
      {file && <p className="mt-2 text-xs text-blue-700" role="status">{file.name} — ready to upload when you save.</p>}
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
      {(preview || file) && <button type="button" disabled={disabled || checking} onClick={() => { selectionVersion.current += 1; setError(''); onRemove(); }}
        className="mt-2 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">Remove logo</button>}
    </div>
  );
}
