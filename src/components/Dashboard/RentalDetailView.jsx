// src/components/Dashboard/RentalDetailView.jsx
import { useMemo, useState } from 'react';
import { formatDateTime, formatDuration } from '../../utils/dateFormatter';
import RefundModal from '../UI/RefundModal';

export default function RentalDetailView({ kiosk, period, rentalData, onClose, t, onCommand }) {
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [selectedRental, setSelectedRental] = useState(null);

    const getDaysFromPeriod = (periodString) => {
        if (typeof periodString === 'string') return parseInt(periodString, 10) || 0;
        return periodString;
    };

    const rentalsForKiosk = useMemo(() => {
        const now = new Date();
        const startTime = new Date(now);
        if (period === 'today') {
            startTime.setHours(0, 0, 0, 0);
        } else {
            const days = getDaysFromPeriod(period);
            startTime.setDate(now.getDate() - days);
        }

        return (rentalData || [])
            .filter(r => r.rentalStationid === kiosk.stationid && new Date(r.rentalTime) >= startTime)
            .sort((a, b) => new Date(b.rentalTime) - new Date(a.rentalTime));
    }, [kiosk.stationid, period, rentalData]);

    const handleRefundClick = (rental) => {
        setSelectedRental(rental);
        setShowRefundModal(true);
    };

    const handleConfirmRefund = (amount) => {
        if (selectedRental) {
            onCommand(kiosk.stationid, 'refund', null, null, null, { orderId: selectedRental.orderid, amount });
        }
        setShowRefundModal(false);
        setSelectedRental(null);
    };

    const getStatusChip = (status) => {
        const statusStyles = {
            rented: 'bg-blue-100 text-blue-800',
            returned: 'bg-green-100 text-green-800',
            lost: 'bg-red-100 text-red-800',
            refunded: 'bg-purple-100 text-purple-800',
        };
        return <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}>{t(status)}</span>;
    };

    return (
        <div className="mt-2 bg-white rounded-lg shadow-lg border border-gray-200 detail-panel-enter detail-panel-enter-active">
            <RefundModal
                isOpen={showRefundModal}
                onClose={() => setShowRefundModal(false)}
                onConfirm={handleConfirmRefund}
                t={t}
            />
            <div className="p-4">
                <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-gray-800">{t('rental_activity')} ({t(period === 'today' ? 'today' : `days_${getDaysFromPeriod(period)}`)})</h4>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                    {rentalsForKiosk.length > 0 ? (
                        <table className="min-w-full divide-y divide-gray-200 text-[11px]">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">{t('card')}</th>
                                    <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">{t('rental')}</th>
                                    <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">{t('return')}</th>
                                    <th scope="col" className="px-2 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">{t('period')}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {rentalsForKiosk.map((rental, index) => (
                                    <tr key={`${rental.orderid}-${index}`}>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="font-mono text-gray-800">{rental.card_last4}</div>
                                            <div className="text-gray-500 text-[10px]">{rental.sn}</div>
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="text-gray-800">{formatDateTime(rental.rentalTime)}</div>
                                            <div className="text-gray-500">{rental.rentalStationid}</div>
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="text-gray-800">{rental.returnTime ? formatDateTime(rental.returnTime) : 'In Use'}</div>
                                            <div className="text-gray-500">{rental.returnStationid}</div>
                                        </td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="text-gray-800">{formatDuration(rental.rentalTime, rental.returnTime)}</div>
                                            <div className="text-gray-500 font-mono">
                                                {rental.status !== 'rented' ? `${rental.symbol || ''}${(rental.totalCharged ?? rental.buyprice)?.toFixed(2) || '0.00'}` : ''}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="text-center text-gray-500 py-4">{t('no_rentals_period')}</p>}
                </div>
            </div>
        </div>
    );
}