// src/components/kiosk/GatewayIcon.jsx

function GatewayIcon({ gateway, t }) {
    const iconSize = "h-4 w-4";

    switch (gateway) {
        case 'SCANNER':
            return (
                <div title="Scanner" className="text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m6-16v16M4 9h2m2 0h2m2 0h2m2 0h2M4 15h2m2 0h2m2 0h2m2 0h2" />
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
                    <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6.5 3.5l-1-1M6 12H4m11.5 3.5l1-1M12 20v-1m6-11h-2M7.5 7.5l-1 1M12 4h.01M16 12h-2M7.5 16.5l-1-1M12 20h.01m4.49-12.5l-1 1M12 8V6" />
                    </svg>
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