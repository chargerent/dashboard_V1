import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase-config';
import DemosPage from './pages/DemosPage.jsx';
import './index.css';
const root = createRoot(document.getElementById('root'));
const home = () => { window.location.href = '/portal/'; };
root.render(<p className="p-8 text-slate-500">Loading Demos…</p>);
onAuthStateChanged(auth, async user => {
  if (!user) { root.render(<div className="p-8"><h1 className="text-xl font-bold">Demos</h1><p className="mt-3">Sign in to the dashboard to manage client demos.</p><a className="mt-4 inline-block text-blue-700 underline" href="/portal/">Open dashboard</a></div>); return; }
  try {
    const { claims } = await user.getIdTokenResult();
    root.render(<DemosPage currentUser={{ role: claims.role, username: claims.username }} onNavigateToDashboard={home} onLogout={() => signOut(auth).then(home)} t={key => key} />);
  } catch { root.render(<p className="p-8">Unable to load your dashboard session. <a href="/portal/">Return to dashboard</a></p>); }
});
