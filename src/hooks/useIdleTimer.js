// src/hooks/useIdleTimer.js
import { useState, useEffect, useRef, useCallback } from 'react';

export const useIdleTimer = ({ onIdle, onLogout, idleTimeout = 600000, promptTimeout = 60000 }) => {
    const [showWarning, setShowWarning] = useState(false);
    const [countdown, setCountdown] = useState(promptTimeout / 1000);

    const idleTimer = useRef(null);
    const logoutTimer = useRef(null);

    const reset = useCallback(() => {
        // Clear all existing timers
        clearTimeout(idleTimer.current);
        clearTimeout(logoutTimer.current);
        
        // Reset state
        setShowWarning(false);
        setCountdown(promptTimeout / 1000);
        
        // Start the main idle timer
        idleTimer.current = setTimeout(() => {
            setShowWarning(true);
            onIdle(); // Callback to show a modal
        }, idleTimeout);
    }, [idleTimeout, onIdle, promptTimeout]);

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
            logoutTimer.current = setTimeout(onLogout, promptTimeout);
        }
        return () => clearTimeout(logoutTimer.current);
    }, [showWarning, onLogout, promptTimeout]);

    return { showWarning, handleStay, countdown };
};