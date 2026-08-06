// src/components/kiosk/GatewayIcon.jsx

import { QrCodeIcon } from '@heroicons/react/24/outline';

function GatewayIcon({ gateway, _t }) {
    const iconSize = "h-4 w-4";

    switch (gateway) {
        case 'SCANNER':
            return (
                <div title="Scanner" className="text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8V4a1 1 0 011-1h4m8 0h4a1 1 0 011 1v4m0 8v4a1 1 0 01-1 1h-4M8 21H4a1 1 0 01-1-1v-4M7 8v8m3-8v8m4-8v8m3-8v8" />
                    </svg>
                </div>
            );
        case 'PAYTERP68':
            return <span className="text-xs font-bold text-gray-600" title="Payter P68">P68</span>;
        case 'AUTHORIZENET':
            return (
                <div title="Authorize.net" className="text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                </div>
            );
        case 'STRIPE':
            return (
                <div title="Stripe" className="text-gray-600">
                    <QrCodeIcon className={iconSize} />
                </div>
            );
        case 'PHONE':
            return (
                <div title="Phone" className="text-gray-600">
                     <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                </div>
            );
        case 'APOLLO':
            return <span className="text-xs font-bold text-gray-600" title="Apollo">APO</span>;
        default:
            return null;
    }
}

export default GatewayIcon;
