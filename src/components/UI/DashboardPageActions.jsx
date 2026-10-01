import {
  ArrowRightOnRectangleIcon,
  HomeIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';

const BUTTON_BASE = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

const translatedLabel = (t, key, fallback) => {
  if (typeof t !== 'function') return fallback;
  const value = t(key);
  return value && value !== key ? value : fallback;
};

export function DashboardLanguageToggle({ language, setLanguage, className = '' }) {
  if (typeof setLanguage !== 'function') return null;

  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`} role="group" aria-label="Language">
      {['en', 'fr'].map((nextLanguage) => (
        <button
          key={nextLanguage}
          type="button"
          onClick={() => setLanguage(nextLanguage)}
          className={`rounded-md px-2 py-1 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${language === nextLanguage ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
          aria-pressed={language === nextLanguage}
        >
          {nextLanguage.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
export default function DashboardPageActions({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onLogout,
  t,
  className = '',
}) {
  const homeLabel = translatedLabel(t, 'back_to_dashboard', 'Back to dashboard');
  const adminLabel = translatedLabel(t, 'admin_tools', 'Admin tools');
  const logoutLabel = translatedLabel(t, 'logout', 'Log out');

  if (!onNavigateToDashboard && !onNavigateToAdmin && !onLogout) return null;

  return (
    <nav className={`ml-auto flex shrink-0 items-center gap-2 ${className}`} aria-label="Page navigation">
      {onNavigateToDashboard && (
        <button
          type="button"
          onClick={() => onNavigateToDashboard()}
          className={`${BUTTON_BASE} bg-gray-200 text-gray-700 hover:bg-gray-300`}
          title={homeLabel}
          aria-label={homeLabel}
          data-page-action="home"
        >
          <HomeIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
      {onNavigateToAdmin && (
        <button
          type="button"
          onClick={onNavigateToAdmin}
          className={`${BUTTON_BASE} bg-orange-100 text-orange-700 hover:bg-orange-200`}
          title={adminLabel}
          aria-label={adminLabel}
          data-page-action="admin"
        >
          <UserCircleIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className={`${BUTTON_BASE} bg-red-500 text-white hover:bg-red-600`}
          title={logoutLabel}
          aria-label={logoutLabel}
          data-page-action="logout"
        >
          <ArrowRightOnRectangleIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
    </nav>
  );
}
