import React from 'react';
import UiProfilesPage from '../pages/UiProfilesPage.jsx';

// Use the established profile editor shell with its in-memory preview API.
// The Stripe editor inside it owns a separate, laptop-only LAB-US8004 draft.
export default function StripeProfilesPage() {
  const dashboard = () => {window.location.href = '?page=kiosk-control-lab';};
  return <UiProfilesPage previewMode initialClientId="MIXED SAMPLE" initialSection="stripe"
    currentUser={{isAdmin: true, username: 'local-preview'}}
    onLogout={dashboard} onNavigateToAdmin={dashboard} onNavigateToDashboard={dashboard}
    t={key => ({back_to_dashboard: 'Back to Kiosk Control', admin_tools: 'Kiosk Control', logout: 'Back to Kiosk Control'}[key] || key)} />;
}
