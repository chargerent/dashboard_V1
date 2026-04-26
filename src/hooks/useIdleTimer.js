// src/hooks/useIdleTimer.js
import { useState, useEffect, useRef, useCallback } from 'react';

const NOOP = () => {};

export const useIdleTimer = ({
    onIdle = NOOP,
    onLogout = NOOP,
    idleTimeout = 600000,
    promptTimeout,
    warningTimeout,
}) => {
    const resolvedPromptTimeout = Number(promptTimeout ?? warningTimeout ?? 60000);
    const safePromptTimeout = Number.isFinite(resolvedPromptTimeout) && resolvedPromptTimeout > 0
        ? resolvedPromptTimeout
        : 60000;
    const [showWarning, setShowWarning] = useState(false);
    const [countdown, setCountdown] = useState(safePromptTimeout / 1000);

    const idleTimer = useRef(null);
    const logoutTimer = useRef(null);

    const reset = useCallback(() => {
        // Clear all existing timers
        clearTimeout(idleTimer.current);
        clearTimeout(logoutTimer.current);
        
        // Reset state
        setShowWarning(false);
        setCountdown(safePromptTimeout / 1000);
        
        // Start the main idle timer
        idleTimer.current = setTimeout(() => {
            setShowWarning(true);
            onIdle();
        }, idleTimeout);
    }, [idleTimeout, onIdle, safePromptTimeout]);

    const handleStay = useCallback(() => {
        reset();
    }, [reset]);

    // Set up event listeners for user activity
    useEffect(() => {
        const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
        activityEvents.forEach(event => window.addEventListener(event, reset));
        reset(); // Initial setup

        return () => {
            activityEvents.forEach(event => window.removeEventListener(event, reset));
            clearTimeout(idleTimer.current);
            clearTimeout(logoutTimer.current);
        };
    }, [reset]);

    // Countdown timer when warning is shown
    useEffect(() => {
        if (showWarning) {
            logoutTimer.current = setTimeout(onLogout, safePromptTimeout);
        }
        return () => clearTimeout(logoutTimer.current);
    }, [showWarning, onLogout, safePromptTimeout]);

    return { showWarning, handleStay, countdown };
};
