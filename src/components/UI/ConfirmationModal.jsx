// src/components/UI/ConfirmationModal.jsx

import { useState, useEffect } from 'react';

function ConfirmationModal({ isOpen, onClose, onConfirm, details, t }) {
    const [reason, setReason] = useState('');
    const [checkboxValue, setCheckboxValue] = useState(false);
    
    useEffect(() => {
        if (isOpen) {
            setReason('');
            setCheckboxValue(Boolean(details?.checkbox?.checked));
        }
    }, [details, isOpen]);

    const handleConfirm = () => {
        if (details?.action === 'lock slot') {
            onConfirm(reason);
            return;
        }

        if (details?.checkbox?.name) {
            onConfirm({ [details.checkbox.name]: checkboxValue });
            return;
        }

        onConfirm(null);
    };

    if (!isOpen) return null;

    return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                <h2 className="text-lg font-bold mb-4">{details?.title || t('confirm_action')}</h2>
                <p className="text-gray-600 mb-6">{details?.confirmationText}</p>
                
                {details?.data && (
                    <div className="max-h-60 overflow-y-auto bg-gray-100 p-3 rounded-md text-xs font-mono border">
                        <pre>{JSON.stringify(details.data, null, 2)}</pre>
                    </div>
                )}

                {details?.action === 'unlock slot' && details?.lockReason && (
                    <div className="mb-4 text-sm text-gray-500 italic">
                        Reason: {details.lockReason}
                    </div>
                )}

                {details?.action === 'lock slot' && (
                    <div className="mb-4">
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason for action (optional)"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                    </div>
                )}

                {details?.checkbox?.name && (
                    <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3">
                        <label className={`flex items-start gap-3 ${details.checkbox.disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                            <input
                                type="checkbox"
                                checked={checkboxValue}
                                disabled={details.checkbox.disabled}
                                onChange={(e) => setCheckboxValue(e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                            />
                            <span className="text-sm text-gray-700">
                                {details.checkbox.label}
                            </span>
                        </label>
                        {details?.checkbox?.helperText && (
                            <p className="mt-2 text-xs text-gray-500">
                                {details.checkbox.helperText}
                            </p>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-4 mt-6">
                    <button onClick={onClose} className="bg-gray-300 text-gray-800 font-semibold py-2 px-6 rounded-md hover:bg-gray-400">
                        {t('cancel')}
                    </button>
                    <button onClick={handleConfirm} className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-blue-700">
                        {t('confirm')}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ConfirmationModal;
