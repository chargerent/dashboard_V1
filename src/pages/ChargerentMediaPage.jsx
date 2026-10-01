import { useMemo, useState } from 'react';
import {
  FilmIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';
import MediaCampaignWizard from '../components/media/MediaCampaignWizard.jsx';
import MediaPage from './MediaPage.jsx';
import { filterStationsForClient } from '../utils/helpers.js';

export default function ChargerentMediaPage({
  onLogout,
  onNavigateToDashboard,
  onNavigateToAdmin,
  currentUser,
  allStationsData = [],
  referenceTime,
  t,
  initialTab = 'legacy',
  allowLegacyMedia = true,
  allowCampaignManager = true,
  onNavigateToUiProfiles,
  onNavigateToDeviceManagement,
}) {
  const [mediaTab, setMediaTab] = useState(
    allowCampaignManager && (initialTab === 'campaign' || !allowLegacyMedia) ? 'campaign' : 'legacy',
  );
  const [status, setStatus] = useState(null);
  const visibleStations = useMemo(
    () => filterStationsForClient(allStationsData, currentUser),
    [allStationsData, currentUser],
  );

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
            <p className="mt-1 text-sm text-slate-500">Manage legacy players and Chargerent campaigns from one place.</p>
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
              role="tab"
              id="media-tab-campaign"
              aria-controls="media-panel-campaign"
              aria-selected={mediaTab === 'campaign'}
              onClick={() => setMediaTab('campaign')}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-black transition ${
                mediaTab === 'campaign'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <FilmIcon className="h-5 w-5" />
              Campaign manager
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

        {mediaTab === 'campaign' && allowCampaignManager && (
          <section
            id="media-panel-campaign"
            role="tabpanel"
            aria-labelledby="media-tab-campaign"
            className="space-y-5"
          >
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-950">
              Campaign Manager controls only the Chargerent integrated Android kiosk application. Enroll kiosk apps in Device Management, then create and assign their campaigns here. Checkout presentation is part of each client profile.
              {onNavigateToDeviceManagement && <button type="button" onClick={onNavigateToDeviceManagement} className="ml-2 font-black text-violet-800 underline underline-offset-2 hover:text-violet-950">Open Device Management → App</button>}
              {onNavigateToUiProfiles && <button type="button" onClick={onNavigateToUiProfiles} className="ml-2 font-black text-violet-800 underline underline-offset-2 hover:text-violet-950">Open Client Profiles → Chargerent app</button>}
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-black text-slate-900">Campaign builder</h2>
                <p className="mt-1 text-sm text-slate-500">Build a campaign step by step, preview it live, then choose the enrolled kiosks that should receive it.</p>
              </div>
              <MediaCampaignWizard kiosks={visibleStations} referenceTime={referenceTime} onStatus={setStatus} />
            </section>

          </section>
        )}
      </main>
    </div>
  );
}
