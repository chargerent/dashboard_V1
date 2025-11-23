// src/components/UI/CommandStatusToast.jsx

import { useEffect, useRef, useState } from 'react';

function CommandStatusToast({ status, onDismiss }) {
    const timerRef = useRef(null);
    const styles = {
        sending: { bg: 'bg-gray-500', icon: '...' },
        success: { bg: 'bg-green-500', icon: '✓' },
        error: { bg: 'bg-red-500', icon: '✗' },
        pending: { bg: 'bg-orange-500', icon: '...' },
    };
    const [isVisible, setIsVisible] = useState(false);

    // Default to 'sending' style if the state is unknown
    const currentStyle = styles[status?.state] || styles.sending;

    useEffect(() => {
        // Always clear the previous timer when the effect re-runs
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        if (status) {
            setIsVisible(true);
            // Set a new timer to dismiss the toast
            timerRef.current = setTimeout(() => {
                setIsVisible(false);
                // Allow for the fade-out animation before fully dismissing
                setTimeout(onDismiss, 300);
            }, 5000);
        } else {
            setIsVisible(false);
        }

        // Cleanup function to clear the timer if the component unmounts
        return () => clearTimeout(timerRef.current);
    }, [status]); // Rerun effect only when status object reference changes

    // Don't render anything if there is no status
    if (!status) {
        return null;
    }

    return (
        <div className={`fixed bottom-5 right-5 z-50 transition-all duration-300 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            <div className={`${currentStyle.bg} text-white py-2 px-4 rounded-lg shadow-lg flex items-center`}>
                <span className="font-bold mr-2">{currentStyle.icon}</span>
                <span>{status.message}</span>
            </div>
        </div>
    );
};

export default CommandStatusToast;