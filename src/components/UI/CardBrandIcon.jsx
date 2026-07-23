import amexIcon from '../../assets/nucleo-credit-cards/amex.svg';
import dinersIcon from '../../assets/nucleo-credit-cards/diners.svg';
import discoverIcon from '../../assets/nucleo-credit-cards/discover.svg';
import jcbIcon from '../../assets/nucleo-credit-cards/jcb.svg';
import maestroIcon from '../../assets/nucleo-credit-cards/maestro.svg';
import mastercardIcon from '../../assets/nucleo-credit-cards/mastercard.svg';
import unionpayIcon from '../../assets/nucleo-credit-cards/unionpay.svg';
import visaIcon from '../../assets/nucleo-credit-cards/visa.svg';
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
};

export default function CardBrandIcon({ rental, className = '' }) {
    const brand = getCardBrandDisplay(rental);
    const src = CARD_ICON_SRC[brand.key];

    if (!src) return null;

    return (
        <img
            src={src}
            alt={brand.title}
            title={brand.title}
            className={`h-7 w-12 shrink-0 object-contain ${className}`}
            loading="lazy"
        />
    );
}
