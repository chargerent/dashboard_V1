import {useEffect, useMemo, useState} from 'react';
import {CheckCircleIcon, MagnifyingGlassIcon} from '@heroicons/react/24/outline';
import {callFunctionWithAuth} from '../utils/callableRequest.js';
import DashboardPageActions from '../components/UI/DashboardPageActions.jsx';

const CHARGEDROPS_CITIES_URL =
  'https://firestore.googleapis.com/v1/projects/chargedrops-dev/databases/(default)/documents/cities?pageSize=100';
const HOUSE_REGIONAL_PARTNER_ID = 'OCHARGELLC';
const COMPANY_MANAGED_PARTNER_TYPE = 'company_managed';
const HOUSE_PARTNER_OPTION = {
  uid: '',
  clientId: HOUSE_REGIONAL_PARTNER_ID,
  regionalPartnerType: COMPANY_MANAGED_PARTNER_TYPE,
  contact: {name: 'Ocharge LLC'},
};

const PAYMENT_SCHEDULES = [
  {value: 'monthly', label: 'Monthly'},
  {value: 'quarterly', label: 'Quarterly'},
  {value: 'yearly', label: 'Yearly'},
];

const emptyPlace = {
  placeId: '',
  venueName: '',
  address: '',
  phone: '',
  website: '',
  googleMapsUrl: '',
  openingHours: [],
  lat: null,
  lng: null,
  city: '',
  state: '',
  postalCode: '',
  country: '',
  countryCode: '',
};

const initialForm = {
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  username: '',
  password: '',
  clientId: '',
  partnerClientId: '',
  cityId: '',
  revenueShare: '20',
  paymentSchedule: 'monthly',
};

const initialAgreementForm = {
  legalBusinessName: '',
  effectiveDate: '',
  assetsDeployed: '',
};

function firestoreString(fields, key) {
  return String(fields?.[key]?.stringValue || '').trim();
}

function normalizeCityDocument(document) {
  const fields = document?.fields || {};
  return {
    id: String(document?.name || '').split('/').pop() || '',
    displayName: firestoreString(fields, 'displayName'),
    slug: firestoreString(fields, 'slug'),
    countryCode: firestoreString(fields, 'countryCode'),
  };
}

function usernameSuggestion(email) {
  return String(email || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
}

function clientIdSuggestion(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 18);
}

function isChargeDropsClient(profile) {
  return profile?.product === 'chargedrops' ||
    profile?.portalBrand === 'chargedrops' ||
    profile?.products?.chargedrops === true;
}

function isCompanyManagedClient(profile) {
  return profile?.regionalPartnerType === COMPANY_MANAGED_PARTNER_TYPE ||
    String(profile?.regionalPartnerId || '').trim().toUpperCase() === HOUSE_REGIONAL_PARTNER_ID;
}

function companyRetainedPercent(clientPercent) {
  const parsed = Number(clientPercent);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round((100 - parsed) * 100) / 100;
}

function agreementStatusLabel(status) {
  if (status === 'signed') return 'Client signed';
  if (status === 'awaiting_signature') return 'Awaiting client signature';
  if (status === 'voided') return 'Voided';
  return 'Not prepared';
}

function partnerNotificationStatusLabel(status, reason) {
  if (reason === 'company-managed-location') return 'Not applicable · Company managed';
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed before sending';
  if (status === 'unknown') return 'Delivery uncertain';
  if (status === 'skipped') return 'Skipped';
  if (status === 'sending') return 'Sending';
  return 'No update recorded';
}

function partnerNotificationStatusClass(status) {
  if (status === 'sent') return 'text-emerald-700';
  if (status === 'failed') return 'text-rose-700';
  if (status === 'unknown') return 'text-amber-700';
  return 'text-slate-500';
}

function FormField({label, required = false, hint, children}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">
        {label}{required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export default function ChargeDropsClientSetupPage({
  onNavigateToDashboard,
  onNavigateToAdmin,
  onLogout,
  previewMode = false,
}) {
  const [form, setForm] = useState(initialForm);
  const [place, setPlace] = useState(emptyPlace);
  const [cities, setCities] = useState([]);
  const [partners, setPartners] = useState([]);
  const [existingClients, setExistingClients] = useState([]);
  const [partnerNotifications, setPartnerNotifications] = useState([]);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingPlace, setLoadingPlace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncingUid, setSyncingUid] = useState('');
  const [retryingNotificationId, setRetryingNotificationId] = useState('');
  const [agreementClientUid, setAgreementClientUid] = useState('');
  const [agreementForm, setAgreementForm] = useState(initialAgreementForm);
  const [preparingAgreement, setPreparingAgreement] = useState(false);
  const [milestoneClientUid, setMilestoneClientUid] = useState('');
  const [installationScheduledAt, setInstallationScheduledAt] = useState('');
  const [updatingMilestone, setUpdatingMilestone] = useState('');
  const [message, setMessage] = useState(null);

  const selectedCity = useMemo(
    () => cities.find((city) => city.id === form.cityId) || null,
    [cities, form.cityId],
  );
  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.clientId === form.partnerClientId) || null,
    [form.partnerClientId, partners],
  );
  const companyManagedSelection = form.partnerClientId === HOUSE_REGIONAL_PARTNER_ID;
  const retainedByCompany = companyRetainedPercent(form.revenueShare);
  const latestPartnerNotificationByClient = useMemo(() => {
    const latest = {};
    for (const notification of partnerNotifications) {
      if (notification?.clientUid && !latest[notification.clientUid]) {
        latest[notification.clientUid] = notification;
      }
    }
    return latest;
  }, [partnerNotifications]);

  useEffect(() => {
    let canceled = false;

    async function loadSetupOptions() {
      if (previewMode) {
        setCities([
          {id: 'phoenix', displayName: 'Phoenix', slug: 'phoenix', countryCode: 'US'},
          {id: 'atlanta', displayName: 'Atlanta', slug: 'atlanta', countryCode: 'US'},
        ]);
        setPartners([
          HOUSE_PARTNER_OPTION,
          {uid: 'preview-phoenix', clientId: 'PHOENIX', contact: {name: 'Phoenix Regional Partner'}},
          {uid: 'preview-atlanta', clientId: 'ATLANTA', contact: {name: 'Atlanta Regional Partner'}},
        ]);
        setExistingClients([]);
        setPartnerNotifications([]);
        setLoading(false);
        return;
      }

      try {
        const [usersResult, citiesResponse, notificationsResult] = await Promise.all([
          callFunctionWithAuth('admin_listUsers'),
          fetch(CHARGEDROPS_CITIES_URL),
          callFunctionWithAuth('admin_listChargeDropsPartnerNotifications')
            .catch(() => ({notifications: []})),
        ]);
        if (!citiesResponse.ok) throw new Error('ChargeDrops cities could not be loaded.');
        const citiesPayload = await citiesResponse.json();
        const users = Array.isArray(usersResult?.users) ? usersResult.users : [];
        const cityOptions = (citiesPayload.documents || [])
          .map(normalizeCityDocument)
          .filter((city) => city.id && city.displayName && city.slug)
          .sort((left, right) => left.displayName.localeCompare(right.displayName));

        if (canceled) return;
        setCities(cityOptions);
        const regionalPartners = users
          .filter((profile) => (profile?.role === 'partner' || profile?.partner === true) &&
            String(profile?.clientId || '').trim().toUpperCase() !== HOUSE_REGIONAL_PARTNER_ID)
          .sort((left, right) => String(left.clientId || '').localeCompare(String(right.clientId || '')));
        setPartners([HOUSE_PARTNER_OPTION, ...regionalPartners]);
        setExistingClients(users.filter(isChargeDropsClient));
        setPartnerNotifications(Array.isArray(notificationsResult?.notifications)
          ? notificationsResult.notifications
          : []);
      } catch (error) {
        if (!canceled) setMessage({type: 'error', text: error?.message || 'Client setup options could not be loaded.'});
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    loadSetupOptions();
    return () => { canceled = true; };
  }, [previewMode]);

  const refreshPartnerNotifications = async () => {
    if (previewMode) return;
    try {
      const result = await callFunctionWithAuth('admin_listChargeDropsPartnerNotifications');
      setPartnerNotifications(Array.isArray(result?.notifications) ? result.notifications : []);
    } catch (error) {
      console.warn('ChargeDrops partner delivery status could not be refreshed.', error);
    }
  };

  const updateForm = (key, value) => {
    setForm((previous) => ({...previous, [key]: value}));
  };

  const handleContactEmailChange = (value) => {
    setForm((previous) => ({
      ...previous,
      contactEmail: value,
      username: previous.username || usernameSuggestion(value),
    }));
  };

  const handlePlaceSearch = async () => {
    const query = placeQuery.trim();
    if (query.length < 2 || !selectedCity || searching) return;
    setSearching(true);
    setMessage(null);
    try {
      if (previewMode) {
        setPlaceResults([
          {placeId: 'preview-hudson', name: 'The Hudson Eatery & Bar', formattedAddress: '1601 E Apache Blvd, Tempe, AZ'},
          {placeId: 'preview-cafe', name: 'ChargeDrops Preview Cafe', formattedAddress: '100 Central Ave, Phoenix, AZ'},
        ]);
        return;
      }
      const result = await callFunctionWithAuth('admin_searchChargeDropsPlaces', {
        query,
        city: selectedCity.displayName,
        countryCode: selectedCity.countryCode || '',
      });
      setPlaceResults(Array.isArray(result?.places) ? result.places : []);
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'Google Places search failed.'});
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPlace = async (result) => {
    setLoadingPlace(true);
    setPlaceResults([]);
    setMessage(null);
    try {
      const details = previewMode ? {
        placeId: result.placeId,
        venueName: result.name,
        address: result.formattedAddress,
        phone: '(480) 555-0123',
        website: 'https://example.com',
        googleMapsUrl: 'https://maps.google.com',
        openingHours: ['Monday: 11:00 AM – 10:00 PM', 'Tuesday: 11:00 AM – 10:00 PM'],
        lat: 33.4148,
        lng: -111.9139,
        city: 'Tempe',
        state: 'AZ',
        postalCode: '85281',
        country: 'United States',
        countryCode: 'US',
      } : (await callFunctionWithAuth('admin_getChargeDropsPlace', {placeId: result.placeId}))?.place;

      if (!details?.placeId) throw new Error('Google did not return location details.');
      setPlace({...emptyPlace, ...details});
      setPlaceQuery(details.venueName || result.name || '');
      setForm((previous) => ({
        ...previous,
        clientId: previous.clientId || clientIdSuggestion(details.venueName),
      }));
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'Location details could not be loaded.'});
    } finally {
      setLoadingPlace(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || previewMode) return;

    const revenueShare = Number(form.revenueShare);
    if (!selectedCity || !place.placeId || !form.partnerClientId) {
      setMessage({type: 'error', text: 'Choose a city, regional partner, and verified Google location.'});
      return;
    }
    if (!form.username.trim() || !form.clientId.trim() || !form.contactEmail.trim()) {
      setMessage({type: 'error', text: 'Username, Client ID, and contact email are required.'});
      return;
    }
    if (form.password.length < 12) {
      setMessage({type: 'error', text: 'The temporary password must contain at least 12 characters.'});
      return;
    }
    if (!Number.isFinite(revenueShare) || revenueShare < 0 || revenueShare > 100) {
      setMessage({type: 'error', text: 'Revenue share must be between 0 and 100 percent.'});
      return;
    }
    if (existingClients.some((client) => String(client.clientId || '').toUpperCase() === form.clientId.trim().toUpperCase())) {
      setMessage({type: 'error', text: 'That ChargeDrops Client ID is already in use.'});
      return;
    }

    const clientId = form.clientId.trim().toUpperCase();
    const username = form.username.trim().toLowerCase();
    const now = new Date().toISOString();
    const companyManaged = form.partnerClientId === HOUSE_REGIONAL_PARTNER_ID;
    const profile = {
      username,
      clientId,
      contact: {
        name: form.contactName.trim(),
        email: form.contactEmail.trim().toLowerCase(),
        phone: form.contactPhone.trim(),
      },
      role: 'user',
      partner: false,
      active: true,
      product: 'chargedrops',
      products: {chargedrops: true},
      portalBrand: 'chargedrops',
      regionalPartnerId: form.partnerClientId,
      regionalPartnerUid: selectedPartner?.uid || '',
      regionalPartnerType: companyManaged ? COMPANY_MANAGED_PARTNER_TYPE : 'regional_partner',
      ...(companyManaged ? {partnerRevenueShare: '0'} : {}),
      commission: String(revenueShare),
      revShareModel: 'chargedrops',
      paymentSchedule: form.paymentSchedule,
      paymentAdmin: 'george',
      features: {
        rentals: true,
        details: false,
        stationid: true,
        address: true,
        status: true,
        pricing: false,
        reporting: false,
        rental_counts: true,
        rental_revenue: true,
        client_commission: true,
        rep_commission: false,
        search: false,
        media: false,
        ui_editor: false,
        phone_control: false,
        binding: false,
        testing: false,
        defaultlanguage: 'en',
      },
      commands: {},
      chargedrops: {
        ...(companyManaged ? {
          revenueAllocation: {
            clientPercent: revenueShare,
            partnerPercent: 0,
            companyPercent: companyRetainedPercent(revenueShare),
          },
        } : {}),
        city: {
          id: selectedCity.id,
          displayName: selectedCity.displayName,
          slug: selectedCity.slug,
        },
        location: {
          ...place,
          comingSoon: true,
        },
        agreement: {status: 'not_prepared'},
        onboarding: {
          status: 'account_created',
          profileStatus: 'complete',
          agreementStatus: 'not_prepared',
          payoutStatus: revenueShare > 0 ? 'not_started' : 'not_required',
          publicMapStatus: 'pending_sync',
          installationStatus: 'not_scheduled',
          createdAt: now,
        },
      },
    };

    setSubmitting(true);
    setMessage(null);
    try {
      const result = await callFunctionWithAuth('admin_createChargeDropsClient', {
        username,
        password: form.password,
        clientId,
        profile,
      }, {timeoutMs: 190000});
      const syncResult = result?.venueSync;
      const created = {
        uid: result?.uid || '',
        ...profile,
        regionalPartnerUid: result?.regionalPartnerUid || profile.regionalPartnerUid,
        regionalPartnerType: result?.regionalPartnerType || profile.regionalPartnerType,
        chargedrops: {
          ...profile.chargedrops,
          publicVenueId: syncResult?.venueId || '',
          onboarding: {
            ...profile.chargedrops.onboarding,
            publicMapStatus: syncResult?.ok ? 'published' : 'pending_sync',
          },
        },
      };
      setExistingClients((previous) => [...previous, created]);
      void refreshPartnerNotifications();
      setForm(initialForm);
      setPlace(emptyPlace);
      setPlaceQuery('');
      const deliveryWarnings = [
        result?.credentialsEmailError,
        result?.venueSyncError,
        ...(Array.isArray(result?.partnerNotifications) ? result.partnerNotifications
          .filter((notification) => ['failed', 'unknown'].includes(notification?.status))
          .map(() => 'A regional partner update could not be confirmed.') : []),
      ].filter(Boolean);
      setMessage(deliveryWarnings.length ? {
        type: 'warning',
        text: `${place.venueName}'s client account was created. ${deliveryWarnings.join(' ')}`,
      } : {
        type: 'success',
        text: companyManaged
          ? `${place.venueName} was created, invited, and published as Coming soon. Ocharge LLC manages the location; no regional-partner notification is required.`
          : `${place.venueName} was created, invited, published as Coming soon, and the regional partner was notified.`,
      });
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The ChargeDrops client could not be created.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncVenue = async (client) => {
    if (!client?.uid || syncingUid) return;
    setSyncingUid(client.uid);
    setMessage(null);
    try {
      const result = await callFunctionWithAuth('admin_syncChargeDropsVenue', {uid: client.uid}, {timeoutMs: 60000});
      setExistingClients((previous) => previous.map((entry) => entry.uid === client.uid ? {
        ...entry,
        chargedrops: {
          ...entry.chargedrops,
          publicVenueId: result?.venueId || '',
          onboarding: {...entry.chargedrops?.onboarding, publicMapStatus: 'published'},
        },
      } : entry));
      void refreshPartnerNotifications();
      setMessage({type: 'success', text: `${client.chargedrops?.location?.venueName || client.clientId} is now published on the ChargeDrops map.`});
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The Coming soon map listing could not be published.'});
    } finally {
      setSyncingUid('');
    }
  };

  const selectAgreementClient = (client) => {
    setAgreementClientUid(client.uid || '');
    setAgreementForm({
      legalBusinessName: client.chargedrops?.agreement?.legalBusinessName ||
        client.chargedrops?.location?.venueName || '',
      effectiveDate: new Date().toISOString().slice(0, 10),
      assetsDeployed: '',
    });
  };

  const handlePrepareAgreement = async () => {
    if (!agreementClientUid || preparingAgreement || previewMode) return;
    if (!agreementForm.legalBusinessName.trim() || !agreementForm.effectiveDate ||
      !agreementForm.assetsDeployed.trim()) {
      setMessage({
        type: 'error',
        text: 'Legal business name, agreement/start date, and assets deployed are required.',
      });
      return;
    }
    setPreparingAgreement(true);
    setMessage(null);
    try {
      const result = await callFunctionWithAuth('admin_prepareChargeDropsAgreement', {
        uid: agreementClientUid,
        legalBusinessName: agreementForm.legalBusinessName.trim(),
        effectiveDate: agreementForm.effectiveDate,
        assetsDeployed: agreementForm.assetsDeployed.trim(),
      }, {timeoutMs: 120000});
      const agreement = result?.agreement;
      setExistingClients((previous) => previous.map((client) => (
        client.uid === agreementClientUid ? {
          ...client,
          chargedrops: {
            ...client.chargedrops,
            agreement: {
              ...(client.chargedrops?.agreement || {}),
              ...agreement,
              legalBusinessName: agreementForm.legalBusinessName.trim(),
            },
            onboarding: {
              ...client.chargedrops?.onboarding,
              agreementStatus: agreement?.status || 'awaiting_signature',
            },
          },
        } : client
      )));
      void refreshPartnerNotifications();
      setAgreementClientUid('');
      setAgreementForm(initialAgreementForm);
      setMessage({
        type: agreement?.notificationStatus === 'unknown' ? 'warning' : 'success',
        text: agreement?.notificationStatus === 'unknown'
          ? 'The ChargeRent agreement was prepared, but delivery email could not be confirmed.'
          : 'The ChargeRent agreement was prepared and the client was notified.',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error?.message || 'The ChargeRent agreement could not be prepared.',
      });
    } finally {
      setPreparingAgreement(false);
    }
  };

  const handleRetryPartnerNotification = async (notification) => {
    if (!notification?.id || notification.status !== 'failed' || retryingNotificationId) return;
    setRetryingNotificationId(notification.id);
    setMessage(null);
    try {
      const result = await callFunctionWithAuth('admin_retryChargeDropsPartnerNotification', {
        notificationId: notification.id,
      });
      await refreshPartnerNotifications();
      setMessage(result?.status === 'sent' ? {
        type: 'success',
        text: 'The regional partner update was sent successfully.',
      } : {
        type: 'warning',
        text: 'The regional partner update still could not be confirmed.',
      });
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The regional partner update could not be retried.'});
    } finally {
      setRetryingNotificationId('');
    }
  };

  const handleUpdateMilestone = async (milestone) => {
    if (!milestoneClientUid || updatingMilestone || previewMode) return;
    if (milestone === 'installation_scheduled' && !installationScheduledAt) {
      setMessage({type: 'error', text: 'Choose the installation date and time.'});
      return;
    }
    setUpdatingMilestone(milestone);
    setMessage(null);
    const milestoneClient = existingClients.find((client) => client.uid === milestoneClientUid);
    const companyManaged = isCompanyManagedClient(milestoneClient);
    try {
      const result = await callFunctionWithAuth('admin_updateChargeDropsOnboardingMilestone', {
        uid: milestoneClientUid,
        milestone,
        scheduledAt: milestone === 'installation_scheduled'
          ? new Date(installationScheduledAt).toISOString()
          : '',
      }, {timeoutMs: 60000});
      setExistingClients((previous) => previous.map((client) => (
        client.uid === milestoneClientUid ? {
          ...client,
          chargedrops: {
            ...client.chargedrops,
            onboarding: {
              ...client.chargedrops?.onboarding,
              status: milestone,
              installationStatus: result?.installationStatus,
              ...(result?.scheduledAt ? {installationScheduledFor: result.scheduledAt} : {}),
              ...(milestone === 'location_live' ? {publicMapStatus: 'live'} : {}),
            },
          },
        } : client
      )));
      await refreshPartnerNotifications();
      setMessage({
        type: companyManaged || result?.partnerNotification?.status === 'sent' ? 'success' : 'warning',
        text: companyManaged
          ? 'The onboarding milestone was saved. This location is company-managed, so no regional-partner email is required.'
          : result?.partnerNotification?.status === 'sent'
            ? 'The onboarding milestone was saved and the regional partner was notified.'
            : 'The onboarding milestone was saved, but the regional partner email was not confirmed.',
      });
      if (milestone === 'location_live') {
        setMilestoneClientUid('');
        setInstallationScheduledAt('');
      }
    } catch (error) {
      setMessage({type: 'error', text: error?.message || 'The onboarding milestone could not be saved.'});
    } finally {
      setUpdatingMilestone('');
    }
  };

  const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}chargedrops-drop.svg`} alt="" className="h-10 w-7" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">ChargeDrops</p>
              <h1 className="text-xl font-bold text-slate-900">Client Setup</h1>
            </div>
          </div>
          <DashboardPageActions
            onNavigateToDashboard={onNavigateToDashboard}
            onNavigateToAdmin={onNavigateToAdmin}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {previewMode && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
              Local preview. Location search uses sample data and account creation is disabled.
            </div>
          )}
          {message && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : message.type === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
              {message.text}
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">1 · Ownership</p>
              <h2 className="mt-1 text-lg font-bold">City and regional partner</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="ChargeDrops city" required>
                <select value={form.cityId} onChange={(event) => updateForm('cityId', event.target.value)} disabled={loading} className={inputClass} required>
                  <option value="">{loading ? 'Loading cities…' : 'Choose a city'}</option>
                  {cities.map((city) => <option key={city.id} value={city.id}>{city.displayName}</option>)}
                </select>
              </FormField>
              <FormField
                label="Regional partner"
                required
                hint={companyManagedSelection
                  ? 'Company-managed location. Ocharge LLC receives the remainder after the client share; regional-partner share is 0%.'
                  : 'Controls the kiosk relationship through info.rep.'}
              >
                <select value={form.partnerClientId} onChange={(event) => updateForm('partnerClientId', event.target.value)} disabled={loading} className={inputClass} required>
                  <option value="">{loading ? 'Loading partners…' : 'Choose a partner'}</option>
                  {partners.map((partner) => (
                    <option key={partner.uid || partner.clientId} value={partner.clientId}>
                      {partner.clientId === HOUSE_REGIONAL_PARTNER_ID
                        ? 'Ocharge LLC · No regional partner'
                        : `${partner.clientId} · ${partner.contact?.name || partner.username || 'Regional partner'}`}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">2 · Location</p>
            <h2 className="mt-1 text-lg font-bold">Find the client venue</h2>
            <p className="mt-1 text-sm text-slate-500">Google Places fills the address, coordinates, phone, website, and opening hours.</p>
            <div className="relative mt-5">
              <div className="flex gap-2">
                <input value={placeQuery} onChange={(event) => { setPlaceQuery(event.target.value); setPlaceResults([]); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handlePlaceSearch(); } }} disabled={!selectedCity || searching} className={inputClass} placeholder={selectedCity ? `Search ${selectedCity.displayName} venues` : 'Choose a city first'} />
                <button type="button" onClick={handlePlaceSearch} disabled={!selectedCity || placeQuery.trim().length < 2 || searching} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
                  <MagnifyingGlassIcon className="h-4 w-4" /> {searching ? 'Searching' : 'Search'}
                </button>
              </div>
              {placeResults.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {placeResults.map((result) => (
                    <button key={result.placeId} type="button" onClick={() => handleSelectPlace(result)} className="block w-full rounded-lg px-3 py-3 text-left hover:bg-indigo-50">
                      <span className="block text-sm font-semibold text-slate-900">{result.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{result.formattedAddress}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadingPlace && <p className="mt-4 text-sm text-indigo-700">Loading verified location details…</p>}
            {place.placeId && (
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <p className="font-bold text-slate-900">{place.venueName}</p>
                    <p className="mt-1 text-sm text-slate-600">{place.address}</p>
                    <p className="mt-2 text-xs text-slate-500">{place.phone || 'No phone listed'} · {place.website || 'No website listed'}</p>
                    <p className="mt-1 text-xs font-medium text-emerald-700">Verified Google Place · Public map status: Coming soon after sync</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">3 · Client access</p>
            <h2 className="mt-1 text-lg font-bold">ChargeDrops portal account</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <FormField label="Contact name" required>
                <input value={form.contactName} onChange={(event) => updateForm('contactName', event.target.value)} className={inputClass} required />
              </FormField>
              <FormField label="Contact email" required>
                <input type="email" value={form.contactEmail} onChange={(event) => handleContactEmailChange(event.target.value)} className={inputClass} required />
              </FormField>
              <FormField label="Contact phone">
                <input type="tel" value={form.contactPhone} onChange={(event) => updateForm('contactPhone', event.target.value)} className={inputClass} />
              </FormField>
              <FormField label="Client ID" required hint="Used by kiosk info.client scoping.">
                <input value={form.clientId} onChange={(event) => updateForm('clientId', clientIdSuggestion(event.target.value))} className={inputClass} required />
              </FormField>
              <FormField label="Username" required>
                <input value={form.username} onChange={(event) => updateForm('username', event.target.value.toLowerCase())} className={inputClass} required />
              </FormField>
              <FormField label="Temporary password" required hint="The client receives these credentials in a separate ChargeDrops email. The regional partner never receives them.">
                <input type="password" minLength={12} value={form.password} onChange={(event) => updateForm('password', event.target.value)} className={inputClass} required />
              </FormField>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">4 · Revenue</p>
            <h2 className="mt-1 text-lg font-bold">Client revenue share</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <FormField
                label="Client revenue share percentage"
                required
                hint={companyManagedSelection && retainedByCompany !== null
                  ? `Client receives ${form.revenueShare || 0}%. Regional partner receives 0%. Ocharge LLC retains ${retainedByCompany}%.`
                  : 'Percentage of eligible rental revenue paid to the venue client.'}
              >
                <div className="relative">
                  <input type="number" min="0" max="100" step="0.1" value={form.revenueShare} onChange={(event) => updateForm('revenueShare', event.target.value)} className={`${inputClass} pr-10`} required />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500">%</span>
                </div>
              </FormField>
              <FormField label="Payment schedule" required>
                <select value={form.paymentSchedule} onChange={(event) => updateForm('paymentSchedule', event.target.value)} className={inputClass}>
                  {PAYMENT_SCHEDULES.map((schedule) => <option key={schedule.value} value={schedule.value}>{schedule.label}</option>)}
                </select>
              </FormField>
            </div>
          </section>

          <button type="submit" disabled={submitting || previewMode} className="w-full rounded-2xl bg-indigo-600 px-5 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
            {submitting ? 'Creating ChargeDrops client…' : previewMode ? 'Account creation disabled in preview' : 'Create ChargeDrops client'}
          </button>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
            <div className="flex items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}chargedrops-drop.svg`} alt="" className="h-12 w-8 rounded bg-white p-1" />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Client journey</p>
                <p className="font-bold">Branded portal only</p>
              </div>
            </div>
            <ol className="mt-5 space-y-3 text-sm text-slate-300">
              <li>1. Admin creates the client and location.</li>
              <li>2. Client signs in to a limited ChargeDrops view.</li>
              <li>3. Admin prepares the ChargeRent revenue-share agreement.</li>
              <li>4. Client signs with email verification, then sets up payouts.</li>
              <li>5. Admin schedules installation, confirms the kiosk, and launches the venue.</li>
              <li>6. Partner continues using the Chargerent dashboard.</li>
            </ol>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-900">ChargeDrops clients</h2>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{existingClients.length}</span>
            </div>
            <div className="mt-4 space-y-3">
              {existingClients.length === 0 ? (
                <p className="text-sm text-slate-500">No ChargeDrops client accounts yet.</p>
              ) : existingClients.slice(0, 8).map((client) => {
                const partnerNotification = latestPartnerNotificationByClient[client.uid];
                return (
                <div key={client.uid || client.clientId} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-bold text-slate-900">{client.chargedrops?.location?.venueName || client.contact?.name || client.clientId}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {client.clientId} · {isCompanyManagedClient(client)
                      ? 'Ocharge LLC · Company managed'
                      : client.regionalPartnerId || 'No partner'}
                  </p>
                  <p className="mt-1 text-xs font-medium text-indigo-700">{client.commission || 0}% · {client.paymentSchedule || 'monthly'}</p>
                  <p className={`mt-2 text-xs font-semibold ${client.chargedrops?.onboarding?.agreementStatus === 'signed' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    Agreement · {agreementStatusLabel(client.chargedrops?.onboarding?.agreementStatus)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-600">
                    Installation · {String(client.chargedrops?.onboarding?.installationStatus || 'not scheduled').replaceAll('_', ' ')}
                  </p>
                  <p className={`mt-2 text-xs font-semibold ${partnerNotificationStatusClass(partnerNotification?.status)}`}>
                    Partner email · {partnerNotificationStatusLabel(partnerNotification?.status, partnerNotification?.reason)}
                  </p>
                  {partnerNotification?.stage && (
                    <p className="mt-0.5 text-xs text-slate-500">{partnerNotification.stage}</p>
                  )}
                  {partnerNotification?.status === 'unknown' && (
                    <p className="mt-1 text-[11px] leading-4 text-amber-700">Check delivery before resending to avoid a duplicate email.</p>
                  )}
                  {partnerNotification?.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => handleRetryPartnerNotification(partnerNotification)}
                      disabled={Boolean(retryingNotificationId)}
                      className="mt-2 w-full rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {retryingNotificationId === partnerNotification.id ? 'Retrying…' : 'Retry partner email'}
                    </button>
                  )}
                  {!['published', 'live'].includes(client.chargedrops?.onboarding?.publicMapStatus) ? (
                    <button
                      type="button"
                      onClick={() => handleSyncVenue(client)}
                      disabled={!client.uid || Boolean(syncingUid)}
                      className="mt-3 w-full rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {syncingUid === client.uid ? 'Publishing…' : 'Publish Coming soon'}
                    </button>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-emerald-700">
                      Published · {client.chargedrops?.onboarding?.publicMapStatus === 'live' ? 'Live' : 'Coming soon'}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => selectAgreementClient(client)}
                    disabled={!client.uid || preparingAgreement}
                    className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {client.chargedrops?.onboarding?.agreementStatus === 'signed'
                      ? 'Prepare replacement agreement'
                      : client.chargedrops?.onboarding?.agreementStatus === 'awaiting_signature'
                        ? 'Replace agreement'
                        : 'Prepare ChargeRent agreement'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMilestoneClientUid(client.uid || '');
                      const scheduled = client.chargedrops?.onboarding?.installationScheduledFor;
                      setInstallationScheduledAt(scheduled ? String(scheduled).slice(0, 16) : '');
                    }}
                    disabled={!client.uid || Boolean(updatingMilestone)}
                    className="mt-2 w-full rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Manage installation & launch
                  </button>
                </div>
                );
              })}
            </div>
          </section>

          {agreementClientUid && (
            <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">ChargeRent template</p>
              <h2 className="mt-1 font-bold text-slate-900">Prepare client agreement</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Generates the current ChargeRent Revenue Share Agreement V.11.01.2024 using this client&apos;s venue, contact, revenue share, payment schedule, and standard ChargeDrops rental pricing.
              </p>
              <div className="mt-4 space-y-4">
                <FormField label="Legal business name" required>
                  <input
                    type="text"
                    value={agreementForm.legalBusinessName}
                    onChange={(event) => setAgreementForm((previous) => ({...previous, legalBusinessName: event.target.value}))}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Agreement/start date" required>
                  <input
                    type="date"
                    value={agreementForm.effectiveDate}
                    onChange={(event) => setAgreementForm((previous) => ({...previous, effectiveDate: event.target.value}))}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Assets deployed" required hint="Use the exact kiosk model and quantity approved for this venue.">
                  <textarea
                    rows={3}
                    value={agreementForm.assetsDeployed}
                    onChange={(event) => setAgreementForm((previous) => ({...previous, assetsDeployed: event.target.value}))}
                    className={inputClass}
                  />
                </FormField>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAgreementClientUid('')}
                    disabled={preparingAgreement}
                    className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handlePrepareAgreement}
                    disabled={preparingAgreement || previewMode}
                    className="rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                  >
                    {previewMode ? 'Disabled in preview' : preparingAgreement ? 'Preparing…' : 'Prepare & notify'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {milestoneClientUid && (
            <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Installation & launch</p>
              <h2 className="mt-1 font-bold text-slate-900">Update onboarding milestone</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Each saved milestone sends a separate status-only email to the regional partner.
              </p>
              <div className="mt-4 space-y-3">
                <FormField label="Scheduled installation date and time">
                  <input
                    type="datetime-local"
                    value={installationScheduledAt}
                    onChange={(event) => setInstallationScheduledAt(event.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <button
                  type="button"
                  onClick={() => handleUpdateMilestone('installation_scheduled')}
                  disabled={Boolean(updatingMilestone) || previewMode}
                  className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {updatingMilestone === 'installation_scheduled' ? 'Saving…' : 'Save schedule & notify'}
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateMilestone('kiosk_installed')}
                  disabled={Boolean(updatingMilestone) || previewMode}
                  className="w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {updatingMilestone === 'kiosk_installed' ? 'Saving…' : 'Mark kiosk installed & notify'}
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateMilestone('location_live')}
                  disabled={Boolean(updatingMilestone) || previewMode}
                  className="w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {updatingMilestone === 'location_live' ? 'Publishing…' : 'Make location live & notify'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMilestoneClientUid('');
                    setInstallationScheduledAt('');
                  }}
                  disabled={Boolean(updatingMilestone)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
