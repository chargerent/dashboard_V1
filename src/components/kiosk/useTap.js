import { useRef, useCallback } from 'react';

/**
 * A hook to handle tap vs. scroll on both touch and mouse devices.
 * It uses pointer events to correctly distinguish a tap from a scroll/drag gesture.
 */
export const useTap = (callback) => {
  const pointerDownPos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const handlePointerDown = useCallback((e) => {
    // Capture the starting position and reset the dragging flag.
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    // Capture the pointer to ensure we get subsequent events like pointerup.
    e.target.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e) => {
    // If we've already started dragging, no need to check again.
    if (isDragging.current) return;

    const deltaX = Math.abs(e.clientX - pointerDownPos.current.x);
    const deltaY = Math.abs(e.clientY - pointerDownPos.current.y);

    // If the pointer has moved more than a small threshold, flag it as a drag/scroll.
    if (deltaX > 10 || deltaY > 10) {
      isDragging.current = true;
    }
  }, []);

  const handlePointerUp = useCallback((e) => {
    // If the interaction was not a drag, it's a tap. Execute the callback.
    if (!isDragging.current) {
      callback(e);
    }
    // Release the pointer capture.
    e.target.releasePointerCapture(e.pointerId);
  }, [callback]);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    // This CSS property is crucial. It tells the browser that touch gestures on this
    // element are for vertical scrolling, which allows the browser to handle scrolling
    // smoothly without waiting for JavaScript.
    style: { touchAction: 'pan-y' }
  };
};

// Helper remains the same
export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;