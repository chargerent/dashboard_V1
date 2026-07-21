import visaIcon from 'payment-icons/min/flat/visa.svg';
import mastercardIcon from 'payment-icons/min/flat/mastercard.svg';
import amexIcon from 'payment-icons/min/flat/amex.svg';
import discoverIcon from 'payment-icons/min/flat/discover.svg';
import maestroIcon from 'payment-icons/min/flat/maestro.svg';
import dinersIcon from 'payment-icons/min/flat/diners.svg';
import jcbIcon from 'payment-icons/min/flat/jcb.svg';
import unionpayIcon from 'payment-icons/min/flat/unionpay.svg';
import defaultCardIcon from 'payment-icons/min/flat/default.svg';
import { getCardBrandDisplay } from '../../utils/cardBrand.js';

const CARD_ICON_SRC = {
    visa: visaIcon,
    mastercard: mastercardIcon,
    maestro: maestroIcon,
    amex: amexIcon,
    discover: discoverIcon,
    diners: dinersIcon,
    jcb: jcbIcon,
    unionpay: unionpayIcon,
    interac: defaultCardIcon,
    generic: defaultCardIcon,
};

export default function CardBrandIcon({ rental, className = '' }) {
    const brand = getCardBrandDisplay(rental);
    const src = CARD_ICON_SRC[brand.key] || defaultCardIcon;

    return (
        <img
            src={src}
            alt={brand.title}
            title={brand.title}
            className={`h-5 w-8 shrink-0 rounded-sm object-contain grayscale ${className}`}
            loading="lazy"
        />
    );
}
