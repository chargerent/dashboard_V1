import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

const BARCODE_ACTIONS = [
    { value: 'FULL', label: 'Full', description: 'Eject all chargers classified as full' },
    { value: 'EMPTY', label: 'Empty', description: 'Eject all chargers classified as empty' },
    { value: 'ALL', label: 'All', description: 'Eject all chargers' },
];

// Code 39 supports the uppercase admin commands and is widely supported by
// handheld barcode scanners. Each symbol contains five bars and four spaces.
const CODE_39_PATTERNS = {
    '*': 'nwnnwnwnn',
    A: 'wnnnnwnnw',
    E: 'wnnnwwnnn',
    F: 'nnwnwwnnn',
    L: 'nnwnnnnww',
    M: 'wnwnnnnwn',
    P: 'nnwnwnnwn',
    T: 'nnnnwnwwn',
    U: 'wwnnnnnnw',
    Y: 'wwnnwnnnn',
};

function buildBarcodeBars(value) {
    const encodedValue = `*${value}*`;
    const narrow = 2;
    const wide = 5;
    const gap = 2;
    const quietZone = 20;
    let x = quietZone;
    const bars = [];

    encodedValue.split('').forEach((character, characterIndex) => {
        const pattern = CODE_39_PATTERNS[character];
        if (!pattern) return;

        pattern.split('').forEach((widthType, elementIndex) => {
            const width = widthType === 'w' ? wide : narrow;
            if (elementIndex % 2 === 0) {
                bars.push({ x, width });
            }
            x += width;
        });

        if (characterIndex < encodedValue.length - 1) x += gap;
    });

    return { bars, width: x + quietZone };
}

function AdminBarcode({ value }) {
    const { bars, width } = useMemo(() => buildBarcodeBars(value), [value]);

    return (
        <div className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-5 shadow-inner sm:px-6">
            <svg
                viewBox={`0 0 ${width} 96`}
                className="h-auto max-h-56 w-full"
                role="img"
                aria-label={`${value} admin barcode`}
                shapeRendering="crispEdges"
                preserveAspectRatio="xMidYMid meet"
            >
                <rect width={width} height="96" fill="white" />
                {bars.map((bar, index) => (
                    <rect key={`${bar.x}-${index}`} x={bar.x} y="4" width={bar.width} height="76" fill="black" />
                ))}
            </svg>
            <p className="mt-2 text-center font-mono text-2xl font-bold tracking-[0.3em] text-gray-950">
                {value}
            </p>
        </div>
    );
}

function ScannerAdminBarcodeModal({ stationId, isOpen, onClose }) {
    const [selectedBarcode, setSelectedBarcode] = useState('ALL');
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        if (!isOpen) setSelectedBarcode('ALL');
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-950/60 p-0 sm:items-center sm:p-6"
            onClick={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) onClose();
            }}
            role="presentation"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className="max-h-[95dvh] w-full overflow-y-auto rounded-t-3xl bg-gray-50 p-4 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6"
                onClick={(event) => event.stopPropagation()}
                data-scanner-admin-barcode-modal={stationId}
            >
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 id={titleId} className="text-xl font-bold text-gray-950">Scanner admin barcode</h2>
                        <p id={descriptionId} className="mt-1 text-sm text-gray-600">
                            {stationId} · Select a command, then scan the barcode at the kiosk.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="-mr-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="Close scanner admin barcode"
                    >
                        <XMarkIcon className="h-6 w-6" />
                    </button>
                </div>

                <div className="mb-5 grid grid-cols-3 gap-2" role="group" aria-label="Choose admin barcode">
                    {BARCODE_ACTIONS.map((action) => {
                        const isSelected = selectedBarcode === action.value;
                        return (
                            <button
                                key={action.value}
                                type="button"
                                onClick={() => setSelectedBarcode(action.value)}
                                className={`min-h-12 rounded-xl border px-2 py-3 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isSelected
                                    ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50'
                                    }`}
                                aria-pressed={isSelected}
                            >
                                {action.label}
                            </button>
                        );
                    })}
                </div>

                <AdminBarcode value={selectedBarcode} />

            </div>
        </div>,
        document.body,
    );
}

export default ScannerAdminBarcodeModal;
