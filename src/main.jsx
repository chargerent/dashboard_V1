import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root'));
const localCustomerSupport = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('page') === 'customer-support-lab';
const pageModule = localCustomerSupport
  ? import('./pages/CustomerSupportPreviewPage.jsx')
  : import('./App.jsx');
pageModule.then(({ default: Page }) => {
  root.render(<StrictMode><Page /></StrictMode>);
}).catch((error) => {
  console.error('Unable to load dashboard page', error);
  root.render(<p role="alert">Unable to load this page. Please refresh and try again.</p>);
});
