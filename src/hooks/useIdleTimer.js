// src/hooks/useIdleTimer.js
import { useState, useEffect, useRef, useCallback } from 'react';

export const useIdleTimer = ({ onLogout, idleTimeout = 600000, warningTimeout = 60000 }) => {
    const [showWarning, setShowWarning] = useState(false);
    const logoutTimer = useRef(null);
    const warningTimer = useRef(null);
    const lastActivity = useRef(Date.now());

    const handleLogout = useCallback(() => {
        onLogout();
    }, [onLogout]);

    const handleShowWarning = useCallback(() => {
        setShowWarning(true);
        logoutTimer.current = setTimeout(handleLogout, warningTimeout);
    }, [handleLogout, warningTimeout]);

    const resetTimers = useCallback(() => {
        clearTimeout(warningTimer.current);
        clearTimeout(logoutTimer.current);
        lastActivity.current = Date.now();
        warningTimer.current = setTimeout(handleShowWarning, idleTimeout);
    }, [handleShowWarning, idleTimeout]);

    const handleStay = useCallback(() => {
        setShowWarning(false);
        resetTimers();
    }, [resetTimers]);

    // This function checks the idle time and triggers actions if needed.
    const checkIdleTime = useCallback(() => {
        const now = Date.now();
        const timeSinceLastActivity = now - lastActivity.current;

        if (timeSinceLastActivity >= idleTimeout + warningTimeout) {
            handleLogout();
        } else if (timeSinceLastActivity >= idleTimeout) {
            if (!showWarning) {
                handleShowWarning();
            }
        }
    }, [idleTimeout, warningTimeout, handleLogout, handleShowWarning, showWarning]);

    // Set up event listeners for user activity
    useEffect(() => {
        const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];

        const handleActivity = () => {
            if (showWarning) {
                // If the warning is already showing, we don't reset the timer,
                // the user must click "Stay Logged In".
                return;
            }
            resetTimers();
        };

        activityEvents.forEach(event => {
            window.addEventListener(event, handleActivity);
        });

        // Check idle time when tab becomes visible again
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkIdleTime();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        resetTimers(); // Initial setup

        return () => {
            activityEvents.forEach(event => window.removeEventListener(event, handleActivity));
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearTimeout(warningTimer.current);
            clearTimeout(logoutTimer.current);
        };
    }, [resetTimers, checkIdleTime, showWarning]);

    return { showWarning, handleStay };
};