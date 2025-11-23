// src/hooks/useTap.js
import { useRef } from 'react';

/**
 * A custom hook to handle tap events on touch devices, avoiding the 300ms delay of onClick.
 * @param {Function} callback - The function to execute on tap.
 * @returns {Object} Props to be spread onto the target element.
 */
export const useTap = (callback) => {
  const touchStart = useRef({ x: 0, y: 0 });

  const handleTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e) => {
    const { clientX, clientY } = e.changedTouches[0];
    const deltaX = Math.abs(clientX - touchStart.current.x);
    const deltaY = Math.abs(clientY - touchStart.current.y);

    // If the touch hasn't moved much, consider it a tap
    if (deltaX < 10 && deltaY < 10) {
      callback(e);
    }
  };

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
  };
};