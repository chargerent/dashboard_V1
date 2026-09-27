import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase-config.js';
import { translations } from '../utils/translations.js';
import CustomerSupportPage from './CustomerSupportPage.jsx';

const t = (key) => translations.en[key] || key;

export default function CustomerSupportPreviewPage() {
  const [authState, setAuthState] = useState({ loading: true, user: null });

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setAuthState({ loading: false, user });
  }), []);

  if (authState.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-sm text-gray-600">Loading Customer Service…</div>;
  }

  if (!authState.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Sign in required</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">Open the local dashboard and sign in with an administrator account before viewing live customer-service records.</p>
          <a href="/portal/" className="mt-5 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Open dashboard sign-in</a>
        </div>
      </div>
    );
  }

  return (
    <CustomerSupportPage
      readOnlyMode
      currentUser={{
        uid: authState.user.uid,
        email: authState.user.email,
        username: authState.user.email?.split('@')[0] || 'Current user',
        features: { rentals: true },
      }}
      onNavigateToDashboard={() => window.location.assign('/portal/')}
      onNavigateToChargers={() => window.location.assign('/portal/')}
      onLogout={() => signOut(auth).then(() => window.location.assign('/portal/'))}
      t={t}
    />
  );
}
