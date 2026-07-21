import { useEffect } from 'react';
import { createPortal } from 'react-dom';

let activeScrollLocks = 0;
let originalBodyOverflow = '';

function ModalPortal({ children }) {
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        if (activeScrollLocks === 0) {
            originalBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        activeScrollLocks += 1;

        return () => {
            activeScrollLocks = Math.max(0, activeScrollLocks - 1);
            if (activeScrollLocks === 0) {
                document.body.style.overflow = originalBodyOverflow;
            }
        };
    }, []);

    if (typeof document === 'undefined') return children;
    return createPortal(children, document.body);
}

export default ModalPortal;
