import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// Resolve the local lab before importing App so its Firebase and command clients
// are never initialized when testing media on this laptop.
const localMediaLab = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page') === 'media-lab';
const root = createRoot(document.getElementById('root'));
const localKioskControl = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page') === 'kiosk-control-lab';
const localStripeProfiles = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page') === 'ui-profiles-lab';
const localCustomerSupport = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page') === 'customer-support-lab';
const pageModule = localCustomerSupport
  ? import('./pages/CustomerSupportPreviewPage.jsx')
  : localStripeProfiles
  ? import('./media-lab/StripeProfilesPage.jsx')
  : localKioskControl
  ? import('./media-lab/KioskControl.jsx')
  : localMediaLab
    ? import('./media-lab/MediaStudio.jsx')
    : import('./App.jsx');
pageModule.then(({ default: Page }) => {
  root.render(<StrictMode><Page /></StrictMode>);
}).catch((error) => {
  console.error('Unable to load dashboard page', error);
  root.render(<p role="alert">Unable to load this page. Please refresh and try again.</p>);
});
