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
    const countdownTimer = useRef(null);
    const onIdleRef = useRef(onIdle);
    const onLogoutRef = useRef(onLogout);
    const warningVisibleRef = useRef(showWarning);
    const lastActivityResetRef = useRef(0);

    useEffect(() => {
        onIdleRef.current = onIdle;
        onLogoutRef.current = onLogout;
    }, [onIdle, onLogout]);

    useEffect(() => {
        warningVisibleRef.current = showWarning;
    }, [showWarning]);

    const reset = useCallback(() => {
        // Clear all existing timers
        clearTimeout(idleTimer.current);
        clearTimeout(logoutTimer.current);
        
        // Reset state
        setShowWarning(previous => previous ? false : previous);
        setCountdown(previous => previous === Math.ceil(safePromptTimeout / 1000)
            ? previous
            : Math.ceil(safePromptTimeout / 1000));
        
        // Start the main idle timer
        idleTimer.current = setTimeout(() => {
            setShowWarning(true);
            onIdleRef.current();
        }, idleTimeout);
    }, [idleTimeout, safePromptTimeout]);

    const handleStay = useCallback(() => {
        reset();
    }, [reset]);

    // Set up event listeners for user activity
    useEffect(() => {
        const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
        const handleActivity = () => {
            const now = Date.now();
            if (!warningVisibleRef.current && now - lastActivityResetRef.current < 1_000) return;
            lastActivityResetRef.current = now;
            reset();
        };
        activityEvents.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));
        reset(); // Initial setup

        return () => {
            activityEvents.forEach(event => window.removeEventListener(event, handleActivity));
            clearTimeout(idleTimer.current);
            clearTimeout(logoutTimer.current);
            clearInterval(countdownTimer.current);
        };
    }, [reset]);

    // Countdown timer when warning is shown
    useEffect(() => {
        if (showWarning) {
            const deadline = Date.now() + safePromptTimeout;
            setCountdown(Math.ceil(safePromptTimeout / 1000));
            countdownTimer.current = setInterval(() => {
                setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
            }, 1_000);
            logoutTimer.current = setTimeout(() => onLogoutRef.current(), safePromptTimeout);
        }
        return () => {
            clearTimeout(logoutTimer.current);
            clearInterval(countdownTimer.current);
        };
    }, [showWarning, safePromptTimeout]);

    return { showWarning, handleStay, countdown };
};
