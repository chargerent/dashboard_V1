// Add Demos without replacing the live portal's repaired application bundle.
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
const config = { apiKey: 'AIzaSyDkzUHzsNx5rJCE0i-bQ_g9n0-5L4cKQh4', authDomain: 'node-red-alerts.firebaseapp.com', projectId: 'node-red-alerts', appId: '1:176963151151:web:73ba0776a231da4154adda' };
const app = getApps()[0] || initializeApp(config);
let observer;
onAuthStateChanged(getAuth(app), async user => {
  observer?.disconnect();
  document.querySelectorAll('[data-demos-link]').forEach(link => link.remove());
  if (!user) return;
  const { claims } = await user.getIdTokenResult();
  if (claims.role !== 'admin' && claims.username !== 'chargerent') return;
  const attach = () => {
    const nav = document.querySelector('header nav[aria-label="Page navigation"]');
    if (!nav || nav.querySelector('[data-demos-link]')) return;
    const link = document.createElement('a'); link.href = '/portal/demos/'; link.dataset.demosLink = 'true'; link.textContent = 'Demos'; link.setAttribute('aria-label', 'Demos');
    link.className = 'inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-blue-100 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-200';
    nav.prepend(link);
  };
  observer = new MutationObserver(attach); observer.observe(document.body, { childList: true, subtree: true }); attach();
});
