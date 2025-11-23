// src/components/UI/RefundModal.jsx
import { useState } from 'react';

export default function RefundModal({ isOpen, onClose, onConfirm, t, rental }) {
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (amount === '') {
            setError(t('amount_required'));
            return;
        }
        onConfirm(amount);
        resetState();
    };

    const handleFullRefund = () => {
        onConfirm('full');
        resetState();
    };

    const resetState = () => {
        setAmount('');
        setError('');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4">{t('confirm_refund_title')}</h3>
                <p className="text-sm text-gray-600 mb-4">{t('confirm_refund_text')}</p>
                <div className="mb-4">
                    <label htmlFor="refund-amount" className="block text-sm font-medium text-gray-700">{t('refund_amount')}</label>
                    <input
                        id="refund-amount"
                        type="number"
                        value={amount}
                        onChange={(e) => { setAmount(e.target.value); setError(''); }}
                        className={`mt-1 block w-full border rounded-md shadow-sm p-2 ${error ? 'border-red-500' : 'border-gray-300'}`}
                        placeholder="0.00"
                    />
                    {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
                </div>
                <div className="flex justify-between items-center gap-3">
                    <button onClick={handleFullRefund} className="bg-yellow-500 text-white font-bold py-2 px-4 rounded-md hover:bg-yellow-600 transition-all">{t('full_refund')}</button>
                    <div className="flex-grow flex justify-end gap-3">
                        <button onClick={resetState} className="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-md hover:bg-gray-400 transition-all">{t('cancel')}</button>
                        <button onClick={handleConfirm} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition-all">{t('ok')}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}