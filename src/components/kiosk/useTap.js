// src/hooks/useTap.js
import { useRef, useCallback } from 'react';

/**
 * Checks if the device is touch-enabled.
 * @returns {boolean} True if the device supports touch events.
 */
export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/**
 * A custom hook to handle tap events on touch devices, avoiding the 300ms delay of onClick.
 * It also handles standard click events for non-touch devices.
 * @param {Function} callback - The function to execute on tap.
 * @returns {Object} Props to be spread onto the target element.
 */
export const useTap = (callback) => {
  const touchStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const handleTouchStart = useCallback((e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    isDragging.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    const { clientX, clientY } = e.touches[0];
    const deltaX = Math.abs(clientX - touchStart.current.x);
    const deltaY = Math.abs(clientY - touchStart.current.y);
    if (deltaX > 10 || deltaY > 10) {
      isDragging.current = true;
    }
  }, []);

  const handleClick = useCallback((e) => {
    // For touch events, we check if it was a drag. For mouse events, we always proceed.
    if (e.nativeEvent.sourceCapabilities?.firesTouchEvents) {
      if (!isDragging.current) {
        callback(e);
      }
    } else {
      // Standard mouse click
      callback(e);
    }
  }, [callback]);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onClick: handleClick,
  };
};