import { useState } from 'react';
import {FilmIcon,PhotoIcon} from '@heroicons/react/24/outline';

import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';
import MediaPage from './MediaPage.jsx';

export default function ChargerentMediaPage({
  onLogout,
  onNavigateToDashboard,
  onNavigateToAdmin,
  currentUser,
  allStationsData = [],
  referenceTime,
  t,
  allowLegacyMedia = true,
  allowCampaignManager = true,
  onNavigateToUiProfiles,
}) {
  const [mediaTab, setMediaTab] = useState(
    'legacy',
  );
  const [status, setStatus] = useState(null);


  return (
    <div
      className="min-h-screen bg-slate-100 text-slate-900"
      data-media-control-page="true"
      data-chargerent-media-page="true"
    >
      <CommandStatusToast status={status} onDismiss={() => setStatus(null)} />
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-slate-900">Media Control</h1>
            <p className="mt-1 text-sm text-slate-500">Manage legacy players. Client campaigns are in the UI Editor.</p>
          </div>
          <DashboardPageActions
            onNavigateToDashboard={onNavigateToDashboard}
            onNavigateToAdmin={onNavigateToAdmin}
            onLogout={onLogout}
            t={t}
          />
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <nav
          className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2"
          aria-label="Media control modes"
          role="tablist"
        >
          {allowLegacyMedia && (
            <button
              type="button"
              role="tab"
              id="media-tab-legacy"
              aria-controls="media-panel-legacy"
              aria-selected={mediaTab === 'legacy'}
              onClick={() => setMediaTab('legacy')}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black transition ${
                mediaTab === 'legacy'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <PhotoIcon className="h-5 w-5" />
              Legacy media player
            </button>
          )}
          {allowCampaignManager && (
            <button
              type="button"
              onClick={onNavigateToUiProfiles}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black transition ${
                mediaTab === 'campaign'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FilmIcon className="h-5 w-5" />
              Client campaigns → UI Editor
            </button>
          )}
        </nav>

        {mediaTab === 'legacy' && allowLegacyMedia && (
          <section
            id="media-panel-legacy"
            role="tabpanel"
            aria-labelledby="media-tab-legacy"
          >
            <MediaPage
              embedded
              onLogout={onLogout}
              onNavigateToDashboard={onNavigateToDashboard}
              onNavigateToAdmin={onNavigateToAdmin}
              currentUser={currentUser}
              allStationsData={allStationsData}
              referenceTime={referenceTime}
              t={t}
            />
          </section>
        )}

      </main>
    </div>
  );
}
