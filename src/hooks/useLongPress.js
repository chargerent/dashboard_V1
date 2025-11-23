// src/hooks/useLongPress.js
import { useCallback, useRef } from 'react';

const useLongPress = (
    onLongPress,
    onClick,
    { shouldPreventDefault = true, delay = 500 } = {}
) => {
    const timeout = useRef();
    const pressHandled = useRef(false);

    const start = useCallback(
        event => {
            if (shouldPreventDefault && event.target) {
                event.target.addEventListener("touchend", preventDefault, { passive: false });
            }
            pressHandled.current = false;
            timeout.current = setTimeout(() => {
                onLongPress(event);
                pressHandled.current = true;
            }, delay);
        },
        [onLongPress, delay, shouldPreventDefault]
    );

    const clear = useCallback(
        (event, shouldTriggerClick = true) => {
            clearTimeout(timeout.current);
            if (shouldTriggerClick && !pressHandled.current) {
                onClick(event);
                pressHandled.current = true; // Mark as handled to prevent native click
            }
        },
        [onClick]
    );

    const handleClick = useCallback(event => {
        // If the action was already handled by onMouseUp/onTouchEnd, prevent the native click.
        if (pressHandled.current) {
            event.preventDefault();
        }
    }, []);

    const preventDefault = e => e.cancelable && e.preventDefault();

    return {
        onMouseDown: start,
        onTouchStart: start,
        onMouseUp: e => clear(e),
        onMouseLeave: e => clear(e, false),
        onTouchEnd: e => clear(e),
        onClick: handleClick, // We still need this to catch and prevent unwanted clicks
    };
};

export default useLongPress;