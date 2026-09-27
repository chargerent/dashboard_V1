import {PAYTER_LANGUAGES, getPayterScreenModel} from '../../utils/payterTerminal.js';
import '../../pages/PayterPage.css';
import {getApolloScreenContent} from '../../../functions/apolloScreens.mjs';

function ScreenButton({children, className = '', action, onAction, payload = {}}) {
  return (
    <button
      type="button"
      className={`payter-screen-button ${className} ${onAction ? '' : 'locked'}`}
      onClick={() => onAction?.(action, payload)}
      aria-disabled={!onAction}
    >
      {children}
    </button>
  );
}

function PayterScreenContents({terminal, translations, onAction, customScreen}) {
  if (customScreen) {
    const content = getApolloScreenContent(customScreen, terminal.language);
    return <div className="payter-custom-screen">
      <div className="payter-custom-content">
        <div className="payter-screen-title">{content.title}</div>
        {customScreen.type === 'message' && <div className="payter-screen-subtitle">{content.message}</div>}
      </div>
      <div className="payter-custom-buttons">{content.buttons.map((button) => <ScreenButton key={button.id} className="payter-rent-button" action="custom_screen" payload={{response: button.id}} onAction={onAction}>{button.label}</ScreenButton>)}</div>
    </div>;
  }
  const {page, fields, slot, module} = getPayterScreenModel(terminal, translations);

  if (page === 'startpage') {
    return (
      <>
        <div className="payter-screen-body payter-start-body">
          <div className="payter-carousel" aria-hidden="true">
            <div className="payter-carousel-track">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <div className="payter-carousel-item" key={index} />)}
            </div>
          </div>
          <div className="payter-screen-title">{fields.title}</div>
          <div className="payter-screen-subtitle">{fields.subtitle}</div>
        </div>
        <div className="payter-screen-footer">
          <ScreenButton className="payter-start-button" action="start_process" onAction={onAction}>{fields.startbutton}</ScreenButton>
          <ScreenButton className="payter-language-button" action="change_language" onAction={onAction}>🌐</ScreenButton>
        </div>
      </>
    );
  }

  if (page === 'rentpage') {
    return (
      <>
        <div className="payter-screen-body payter-rent-body"><div className="payter-rent-info">{fields.infotext}</div></div>
        <div className="payter-screen-footer payter-rent-footer">
          <ScreenButton className="payter-rent-button" action="rent" onAction={onAction}>{fields.rentbutton}</ScreenButton>
          <ScreenButton className="payter-rent-button" action="return" onAction={onAction}>{fields.returnbutton}</ScreenButton>
          <ScreenButton className="payter-rent-button payter-rent-cancel" action="cancel" onAction={onAction}>{fields.cancel}</ScreenButton>
        </div>
      </>
    );
  }

  if (page === 'languagepage') {
    return (
      <>
        <div className="payter-screen-body payter-rent-body"><div className="payter-rent-info">Select Language</div></div>
        <div className="payter-screen-footer payter-rent-footer">
          {PAYTER_LANGUAGES.map(({code}) => (
            <ScreenButton key={code} className="payter-rent-button" action="set_language" payload={{language: code}} onAction={onAction}>{fields[code]}</ScreenButton>
          ))}
          <ScreenButton className="payter-rent-button payter-rent-cancel" action="cancel_language_selection" onAction={onAction}>Cancel</ScreenButton>
        </div>
      </>
    );
  }

  if (page === 'paymentpage') {
    return (
      <>
        <div className="payter-screen-body payter-payment-body">
          <svg className="payter-payment-icon" viewBox="0 0 100 80" aria-hidden="true">
            <path d="M35,20 a45,45 0 0,1 0,40" /><path d="M50,27 a30,30 0 0,1 0,26" /><path d="M65,34 a15,15 0 0,1 0,12" />
          </svg>
          <div className="payter-screen-title payter-payment-title">{fields.title}</div>
          <div className="payter-screen-subtitle payter-payment-subtitle">{fields.subtitle}</div>
        </div>
        <div className="payter-screen-footer" />
      </>
    );
  }

  if (['thankyoupage', 'returntypage', 'offlinemodepage'].includes(page)) {
    const showDetails = page !== 'offlinemodepage';
    return (
      <>
        <div className="payter-screen-body payter-thankyou-body">
          <div className="payter-thankyou-header">
            <div className="payter-screen-title">{fields.title}</div>
            {showDetails && <div className="payter-thankyou-details">{fields.modulelabel}: {module} / {fields.slotlabel}: {slot}</div>}
          </div>
        </div>
        <div className="payter-screen-footer payter-thankyou-footer">
          <div className="payter-message-box">
            <div className="payter-message" style={page === 'offlinemodepage' ? {fontWeight: 400} : undefined}>{fields.message}</div>
            <div className="payter-checkmark">✔</div>
          </div>
        </div>
      </>
    );
  }

  if (page === 'nocardpage') {
    return (
      <>
        <div className="payter-screen-body payter-thankyou-body" />
        <div className="payter-screen-footer payter-thankyou-footer">
          <div className="payter-message-box"><div className="payter-nocard-message">{fields.title}</div></div>
        </div>
      </>
    );
  }

  if (page === 'errorpage') {
    return (
      <>
        <div className="payter-screen-body payter-left-body">
          <div className="payter-screen-title">{fields.title}</div>
          <div className="payter-error-message">{fields.message}</div>
        </div>
        <div className="payter-screen-footer" />
      </>
    );
  }

  const title = page === 'returnpage' ? fields.returntitle : fields.title;
  const subtitle = page === 'returnpage' ? fields.returntext : fields.subtitle;
  return (
    <>
      <div className="payter-screen-body payter-left-body">
        <div className="payter-screen-title">{title}</div>
        <div className="payter-screen-subtitle">{subtitle}</div>
      </div>
      <div className="payter-screen-footer" />
    </>
  );
}

export default function PayterTerminalFrame({terminal, translations, compact = false, onAction = null, customScreen = null}) {
  return (
    <div className={`payter-device ${compact ? 'compact' : ''}`}>
      <div className="payter-branding">payter</div>
      <div className="payter-leds" aria-label={terminal.online ? 'Terminal online' : 'Terminal offline'}>
        <span className={`payter-led ${terminal.online ? 'active' : ''}`} /><span className="payter-led" /><span className="payter-led" /><span className="payter-led" />
      </div>
      <div className="payter-screen">
        <PayterScreenContents terminal={terminal} translations={translations} onAction={onAction} customScreen={customScreen} />
      </div>
    </div>
  );
}
