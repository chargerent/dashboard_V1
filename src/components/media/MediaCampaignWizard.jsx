import StationBrandBackground from '../../integrated-media/StationBrandBackground.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloudArrowUpIcon,
  FilmIcon,
  PhotoIcon,
  PlayIcon,
  RectangleGroupIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';

import { callFunctionWithAuth } from '../../utils/callableRequest.js';
import {
  getPhoneConnectionState,
  isIntegratedKiosk,
  normalizePhoneDevice,
} from '../../utils/phoneControl.js';
import { useMediaAssetUrl } from '../../integrated-media/mediaAssetUrl.js';
import { mediaAccessProblem, mediaFetch, mediaHeaders, mediaUrl } from '../../integrated-media/mediaApi.js';
import './media-campaign-wizard.css';
import {buildCampaignDraft, campaignClientId, campaignEditorValues, campaignReplacementAssignments} from '../../utils/mediaCampaign.js';

const API = mediaUrl('/api/').replace(/\/$/, '');
const DEFAULT_POPUP = {
  durationMs: 5000,
  successTemplate: 'Take your charger from slot {slot}.',
  returnTemplate: 'Charger returned. Thank you!',
  failureTemplate: 'Unable to release a charger. Please try again.',
};
const STEPS = [
  { key: 'name', label: 'Name campaign' },
  { key: 'layout', label: 'Choose layout' },
  { key: 'type', label: 'Choose background' },
  { key: 'media', label: 'Add media' },
  { key: 'kiosks', label: 'Pick kiosks' },
];
const LAYOUTS = [
  { id: 'full', label: 'Full page', description: 'One uninterrupted media area.', icon: RectangleGroupIcon, zones: [{ id: 'main', label: 'Full-page media', x: 0, y: 0, width: 1, height: 1 }] },
  { id: 'stack', label: 'Top + instructions', description: '80% media above a 20% instruction area.', icon: RectangleGroupIcon, zones: [
    { id: 'top', label: 'Top media · 1080 × 1536', x: 0, y: 0, width: 1, height: 0.8 },
    { id: 'bottom', label: 'Instructions · 1080 × 384', x: 0, y: 0.8, width: 1, height: 0.2 },
  ] },
];

function isVideo(asset) {
  return String(asset?.mimeType || '').startsWith('video/');
}

function prettyBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
}

async function api(path, options = {}) {
  const response = await mediaFetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error?.message || `Media service returned ${response.status}.`), {
      status: response.status,
      code: body.error?.code,
    });
  }
  return body;
}

function MediaThumb({ asset, className = '' }) {
  const url = useMediaAssetUrl(asset);
  if (!url) return <div className={`${className} animate-pulse bg-slate-200`} />;
  return isVideo(asset)
    ? <video className={className} src={url} muted playsInline preload="metadata" />
    : <img className={className} src={url} alt="" />;
}

function PreviewZone({
  zone,
  assets,
  mediaType,
  editing,
  uploading,
  onDropAsset,
  onUpload,
  onRemove,
}) {
  const first = assets[0];
  const previewUrl = useMediaAssetUrl(first);
  const [dragging, setDragging] = useState(false);
  const style = {
    left: `${zone.x * 100}%`,
    top: `${zone.y * 100}%`,
    width: `${zone.width * 100}%`,
    height: `${zone.height * 100}%`,
  };

  const acceptDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const assetId = event.dataTransfer.getData('application/x-chargerent-media');
    if (assetId) onDropAsset(zone.id, assetId);
    else if (event.dataTransfer.files?.length) onUpload(zone.id, event.dataTransfer.files);
  };

  return (
    <div
      className={`cmw-preview-zone ${dragging ? 'is-dragging' : ''} ${editing ? 'is-editing' : ''}`}
      style={style}
      data-preview-zone={zone.id}
      onDragEnter={(event) => { if (editing) { event.preventDefault(); setDragging(true); } }}
      onDragOver={(event) => { if (editing) event.preventDefault(); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={(event) => editing && acceptDrop(event)}
    >
      {first && previewUrl && (isVideo(first)
        ? <video src={previewUrl} muted autoPlay loop playsInline />
        : <img src={previewUrl} alt={first.name} />)}
      {zone.type === 'text' && <div className="cmw-preview-text" style={{background:zone.background,whiteSpace:'pre-wrap'}}>{zone.text}</div>}
      {!first && zone.type !== 'text' && (
        <div className="cmw-preview-empty">
          {mediaType === 'video' ? <VideoCameraIcon /> : <PhotoIcon />}
          <strong>{editing ? 'Drop media here' : (zone.label || `Section ${zone.id.replaceAll('-', ' ')}`)}</strong>
          <span>{editing ? `or upload ${mediaType === 'video' ? 'a video' : 'an image'}` : 'Media appears here'}</span>
        </div>
      )}
      {first && assets.length > 1 && <span className="cmw-preview-count">+{assets.length - 1}</span>}
      {editing && zone.type !== 'text' && (
        <div className="cmw-preview-zone-actions">
          <button type="button" onClick={() => onUpload(zone.id)} disabled={Boolean(uploading)}>
            <CloudArrowUpIcon /> {uploading ? `${uploading.percent}%` : 'Upload'}
          </button>
          {first && <button type="button" onClick={() => onRemove(zone.id, first.id)}>Remove</button>}
        </div>
      )}
    </div>
  );
}

function CampaignPreview({ campaignName, layout, orientation, mediaType, ownerBrand, zoneMedia, library, editing, upload, checkoutEnabled, onDropAsset, onUpload, onRemove }) {
  const assets = useMemo(() => Object.fromEntries(library.map((asset) => [asset.id, asset])), [library]);
  return (
    <aside className="cmw-preview-panel" aria-label="Live campaign preview">
      <div className="cmw-preview-heading">
        <div>
          <span>LIVE PREVIEW</span>
          <h3>{campaignName.trim() || 'Untitled campaign'}</h3>
        </div>
        <span className="cmw-preview-ratio">{orientation === 'landscape' ? '16:9' : '9:16'}</span>
      </div>
      <div className="cmw-screen-shell">
        <div className="cmw-screen" data-campaign-preview="true" style={{aspectRatio: orientation === 'landscape' ? '16 / 9' : '9 / 16'}}>
          {mediaType === 'brand' ? <StationBrandBackground brand={ownerBrand}/> : layout.zones.map((zone) => (
            <PreviewZone
              key={zone.id}
              zone={zone}
              assets={(zoneMedia[zone.id] || []).map((id) => assets[id]).filter(Boolean)}
              mediaType={mediaType}
              editing={editing}
              uploading={upload?.zoneId === zone.id ? upload : null}
              onDropAsset={onDropAsset}
              onUpload={onUpload}
              onRemove={onRemove}
            />
          ))}
          {checkoutEnabled && <div className="cmw-checkout-preview">
            <span><i /> Ready for payment</span>
            <button type="button" tabIndex="-1">Tap to rent</button>
          </div>}
        </div>
        <div className="cmw-screen-base"><i /><i /><i /></div>
      </div>
      <p className="cmw-preview-help">
        {editing
          ? 'Drag from the media library into any section, or use that section’s Upload button.'
          : 'The preview stays visible while you build the campaign.'}
      </p>
    </aside>
  );
}

export default function MediaCampaignWizard({ clientId, initialCampaign = null, campaigns = [], kiosks = [], referenceTime, onStatus, onSaved, onDirtyChange, onCancel, apiRequest = api, listDevices, previewMode = false }) {
  const api = apiRequest;
  const [initial] = useState(() => campaignEditorValues(initialCampaign));
  const baseDraft = initialCampaign?.draft || {};
  const [editingId, setEditingId] = useState(initialCampaign?.id || '');
  const [editVersion, setEditVersion] = useState(initialCampaign?.editVersion || 0);
  const [layoutOverride, setLayoutOverride] = useState(() => baseDraft.zones?.length && baseDraft.stationBrandBackground !== true ? {id: initial.layout, label: 'Existing layout', zones: baseDraft.zones} : null);
  const [savedFingerprint, setSavedFingerprint] = useState(() => JSON.stringify(initial));
  const [reviewing, setReviewing] = useState(false);
  const [now] = useState(() => Number(referenceTime || Date.now()));
  const [step, setStep] = useState(0);
  const [campaignName, setCampaignName] = useState(initial.name);
  const [layoutId, setLayoutId] = useState(initial.layout);
  const [checkoutEnabled, setCheckoutEnabled] = useState(initial.checkoutEnabled);
  const [mediaType, setMediaType] = useState(initial.mediaType);
  const [zoneMedia, setZoneMedia] = useState(initial.zoneMedia);
  const [library, setLibrary] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedKiosks, setSelectedKiosks] = useState(initial.stationIds);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [upload, setUpload] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(initialCampaign?.revision ? initialCampaign : null);
  const [deliveryByStation, setDeliveryByStation] = useState({});
  const [deliveryError, setDeliveryError] = useState('');
  const fileInput = useRef(null);
  const uploadZone = useRef('main');
  const layout = useMemo(() => layoutOverride || LAYOUTS.find((item) => item.id === layoutId) || LAYOUTS[0], [layoutId, layoutOverride]);
  const fingerprint = JSON.stringify({name:campaignName,layout:layoutId,mediaType,checkoutEnabled,stationIds:selectedKiosks,zoneMedia});
  const dirty = fingerprint !== savedFingerprint;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    let current = true;
    Promise.all([
      api('/library'),
      listDevices ? listDevices() : callFunctionWithAuth('phoneControl_listDevices', { deviceKind: 'integrated_kiosk' }),
    ]).then(([media, inventory]) => {
      if (!current) return;
      setLibrary(Array.isArray(media.assets) ? media.assets : []);
      setDevices((Array.isArray(inventory?.devices) ? inventory.devices : [])
        .map((device) => normalizePhoneDevice(device, device?.id || device?.deviceId))
        .filter((device) => device.id)
        .filter((device) => isIntegratedKiosk(device) && device.stationId));
      setLoadError('');
    }).catch((error) => {
      if (!current) return;
      setLoadError(mediaAccessProblem(error) || error.message || 'Unable to load campaign tools.');
    }).finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [api, listDevices]);

  useEffect(() => {
    const allowed = new Set(layout.zones.map((zone) => zone.id));
    setZoneMedia((current) => Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))));
  }, [layout]);

  useEffect(() => {
    setPublished(null);
    setDeliveryByStation({});
    setDeliveryError('');
  }, [campaignName, layoutId, checkoutEnabled, mediaType, zoneMedia, selectedKiosks]);

  useEffect(() => {
    if (!published?.id) return undefined;
    let current = true;
    let timer;
    const refresh = async () => {
      try {
        const result = await api(`/campaigns/${published.id}/status`);
        if (!current) return;
        const stations = Array.isArray(result.campaign?.stations) ? result.campaign.stations : [];
        setDeliveryByStation(Object.fromEntries(stations.map((station) => [station.stationId, station])));
        setDeliveryError('');
      } catch (error) {
        if (current) setDeliveryError(error.message || 'Delivery status is temporarily unavailable.');
      }
    };
    refresh();
    timer = window.setInterval(refresh, 5000);
    return () => { current = false; window.clearInterval(timer); };
  }, [published?.id]);

  const kioskDetails = useMemo(() => {
    const details = new Map(kiosks.map((kiosk) => [String(kiosk.stationid || kiosk.stationId || '').trim().toUpperCase(), kiosk]));
    return devices.filter((device) => details.has(device.stationId))
      .filter((device) => campaignClientId(details.get(device.stationId)?.info?.client || details.get(device.stationId)?.info?.clientId) === campaignClientId(clientId))
      .map((device) => ({ ...device, kiosk: details.get(device.stationId) }))
      .sort((left, right) => left.stationId.localeCompare(right.stationId));
  }, [clientId, devices, kiosks]);
  const filteredLibrary = useMemo(() => library.filter((asset) => (
    (mediaType === 'video') === isVideo(asset)
    && (!query.trim() || asset.name.toLowerCase().includes(query.trim().toLowerCase()))
  )), [library, mediaType, query]);
  const missingZones = useMemo(() => mediaType === 'brand' ? [] : layout.zones.filter((zone) => zone.type !== 'text' && !(zoneMedia[zone.id] || []).length), [layout, zoneMedia, mediaType]);
  const canContinue = [
    campaignName.trim().length >= 2,
    Boolean(layoutId),
    Boolean(mediaType),
    missingZones.length === 0,
    selectedKiosks.length > 0 && selectedKiosks.every(id => kioskDetails.some(device => device.stationId === id)) && (mediaType !== 'brand' || kioskDetails.filter(device=>selectedKiosks.includes(device.stationId)).every(device=>device.inventory?.media?.supportsStationBackground === true)),
  ][step];
  const deliverySummary = useMemo(() => {
    const values = Object.values(deliveryByStation);
    return values.reduce((summary, item) => ({ ...summary, [item.state]: (summary[item.state] || 0) + 1 }), {});
  }, [deliveryByStation]);

  const addAsset = useCallback((zoneId, assetId) => {
    const asset = library.find((item) => item.id === assetId);
    if (!asset || (mediaType === 'video') !== isVideo(asset)) return;
    setZoneMedia((current) => ({
      ...current,
      [zoneId]: [...new Set([...(current[zoneId] || []), assetId])],
    }));
  }, [library, mediaType]);

  const removeAsset = useCallback((zoneId, assetId) => {
    setZoneMedia((current) => ({
      ...current,
      [zoneId]: (current[zoneId] || []).filter((id) => id !== assetId),
    }));
  }, []);

  const waitForVideo = async (jobId) => {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const result = await api(`/library/jobs/${jobId}`);
      const job = result.job || {};
      setUpload((current) => current ? { ...current, percent: Math.max(current.percent, Number(job.progress) || 0), status: job.stage || job.status } : current);
      if (job.status === 'ready' && job.asset) return job.asset;
      if (['failed', 'cancelled'].includes(job.status)) throw new Error(job.error || 'Video preparation did not finish.');
    }
    throw new Error('Video preparation is taking longer than expected. It will remain in the media library when ready.');
  };

  const uploadOne = async (zoneId, file) => {
    const video = file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name);
    if ((mediaType === 'video') !== video) throw new Error(`This campaign accepts ${mediaType === 'video' ? 'videos' : 'images'} only.`);
    const inferred = video ? (file.type === 'video/quicktime' || /\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4') : file.type;
    const limit = video ? 2 * 1024 ** 3 : 100 * 1024 ** 2;
    if (!file.size || file.size > limit) throw new Error(`${file.name} exceeds the ${video ? '2 GB' : '100 MB'} limit.`);
    setUpload({ zoneId, name: file.name, percent: 0, status: 'uploading' });
    const headers = await mediaHeaders({ 'Content-Type': inferred });
    const result = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${API}/library/${video ? 'video-upload' : 'upload'}?name=${encodeURIComponent(file.name)}`);
      for (const [name, value] of headers) request.setRequestHeader(name, value);
      request.timeout = video ? 30 * 60 * 1000 : 120000;
      request.upload.onprogress = (event) => event.lengthComputable && setUpload((current) => current ? { ...current, percent: Math.round(event.loaded / event.total * 100) } : current);
      request.onload = () => {
        let response = {};
        try { response = JSON.parse(request.responseText); } catch { reject(new Error('The upload returned an unreadable response.')); return; }
        if (request.status >= 200 && request.status < 300) resolve(response);
        else reject(new Error(response.error?.message || 'Upload failed.'));
      };
      request.onerror = () => reject(new Error('Cannot reach the hosted media service.'));
      request.ontimeout = () => reject(new Error('The upload timed out.'));
      request.send(file);
    });
    const asset = video ? await waitForVideo(result.job?.id) : result.asset;
    if (!asset?.id) throw new Error('The media service did not return the uploaded file.');
    setLibrary((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    setZoneMedia((current) => ({ ...current, [zoneId]: [...new Set([...(current[zoneId] || []), asset.id])] }));
  };

  const uploadFiles = async (zoneId, files) => {
    const items = [...(files || [])];
    if (!items.length) {
      uploadZone.current = zoneId;
      fileInput.current?.click();
      return;
    }
    try {
      for (const file of items) await uploadOne(zoneId, file);
      onStatus?.({ state: 'success', message: `${items.length === 1 ? items[0].name : `${items.length} files`} added to ${zoneId.replaceAll('-', ' ')}.` });
    } catch (error) {
      onStatus?.({ state: 'error', message: error.message || 'The media could not be uploaded.' });
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const replacements = campaignReplacementAssignments(campaigns, selectedKiosks, editingId);
  const canSaveDraft = campaignName.trim().length >= 2 && missingZones.length === 0 && !upload;
  const persist = async (publishNow = false) => {
    if (publishing || !canSaveDraft || (publishNow && (!canContinue || previewMode))) return;
    const draft = buildCampaignDraft({clientId,id:editingId,expectedVersion:editVersion,name:campaignName,layout,mediaType,checkoutEnabled,stationIds:selectedKiosks,zoneMedia,library,baseDraft,popup:DEFAULT_POPUP});
    setPublishing(true);
    try {
      const result = await api(publishNow ? '/campaigns/publish' : '/campaigns/draft', {
        method: 'POST', body: JSON.stringify({...draft,...(publishNow ? {expectedAssignments:replacements} : {})}),
      });
      setEditingId(result.campaign.id);
      setEditVersion(result.campaign.editVersion);
      setSavedFingerprint(fingerprint);
      setReviewing(false);
      if (publishNow) setPublished(result.campaign);
      onSaved?.(result.campaign);
      onStatus?.({state:'success',message:publishNow ? `${campaignName.trim()} published to ${selectedKiosks.length} kiosks.` : 'Campaign draft saved. The published campaign keeps playing.'});
    } catch (error) {
      onStatus?.({state:'error',message:error.message || 'The campaign could not be saved.'});
    } finally {setPublishing(false);}
  };

  const stepContent = [
    <div className="cmw-step-body" key="name">
      <span className="cmw-kicker">STEP 1 OF 5</span>
      <h3>Name the campaign</h3>
      <p>Use a clear name your team will recognize later.</p>
      <label className="cmw-field">
        <span>Campaign name</span>
        <input aria-label="Campaign name" autoFocus value={campaignName} maxLength="80" placeholder="Example: Fall airport promotion" onChange={(event) => setCampaignName(event.target.value)} />
        <small>{campaignName.trim().length}/80 characters</small>
      </label>
    </div>,
    <div className="cmw-step-body" key="layout">
      <span className="cmw-kicker">STEP 2 OF 5</span>
      <h3>Choose the screen layout</h3>
      <p>Use the full page, or reserve the lower 20% for clear customer instructions.</p>
      <label className={`cmw-checkout-toggle ${checkoutEnabled ? 'is-on' : ''}`}>
        <span>
          <strong>Checkout</strong>
          <small>{checkoutEnabled ? 'On · Full-page media is required' : 'Off · Both layouts are available'}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={checkoutEnabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            setCheckoutEnabled(enabled);
            if (enabled && layoutId !== 'full') {setLayoutId('full'); setLayoutOverride(null);}
          }}
          aria-label="Enable checkout"
        />
        <i aria-hidden="true"><b /></i>
      </label>
      <div className="cmw-layout-grid">
        {LAYOUTS.map(({ id, label, description, icon: LayoutIcon }) => (
          <button
            type="button"
            key={id}
            className={`${layoutId === id ? 'is-selected' : ''} ${checkoutEnabled && id === 'stack' ? 'is-disabled' : ''}`}
            onClick={() => {setLayoutId(id); setLayoutOverride(null); setZoneMedia({});}}
            disabled={checkoutEnabled && id === 'stack'}
            title={checkoutEnabled && id === 'stack' ? 'Turn checkout off to use the instruction layout.' : ''}
          >
            <span className={`cmw-layout-mini ${id}`}>{Array.from({ length: LAYOUTS.find((item) => item.id === id).zones.length }, (_, index) => <i key={index} />)}</span>
            <span><strong>{label}</strong><small>{checkoutEnabled && id === 'stack' ? 'Unavailable while checkout is on.' : description}</small></span>
            <LayoutIcon />
          </button>
        ))}
      </div>
    </div>,
    <div className="cmw-step-body" key="type">
      <span className="cmw-kicker">STEP 3 OF 5</span>
      <h3>Choose the station background</h3>
      <p>Owner backgrounds follow each station’s brand. Images and videos use your uploaded media.</p>
      <div className="cmw-type-grid">
        {[
          { id: 'brand', label: 'Station owner background', detail: 'ChargeDrops, Event Charging or Chargerent', icon: PhotoIcon },
          { id: 'image', label: 'Images', detail: 'JPG, PNG or WebP slides', icon: PhotoIcon },
          { id: 'video', label: 'Video', detail: 'MP4 or MOV playback', icon: FilmIcon },
        ].map(({ id, label, detail, icon: TypeIcon }) => (
          <button type="button" key={id} className={mediaType === id ? 'is-selected' : ''} onClick={() => {if (id !== mediaType) setZoneMedia({}); setMediaType(id); if (id === 'brand') {setLayoutId('full'); setLayoutOverride(null);}}}>
            <TypeIcon /><strong>{label}</strong><span>{detail}</span>{mediaType === id && <CheckIcon className="cmw-choice-check" />}
          </button>
        ))}
      </div>
    </div>,
    mediaType === 'brand' ? <div className="cmw-step-body" key="media">
      <span className="cmw-kicker">STEP 4 OF 5</span><h3>Background follows the station owner</h3>
      <p>Each selected station uses its saved ChargeDrops, Event Charging or Chargerent brand. Changes to that owner brand update the app background and Android home wallpaper automatically.</p>
    </div> :
    <div className="cmw-step-body cmw-media-step" key="media">
      <span className="cmw-kicker">STEP 4 OF 5</span>
      <h3>Add media to every section</h3>
      <p>Drag a file from the library onto the preview. Drop more than one file into a section to create a playlist.</p>
      <input className="cmw-library-search" aria-label="Search media library" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${mediaType === 'video' ? 'videos' : 'images'}…`} />
      <div className="cmw-library-list">
        {filteredLibrary.map((asset) => (
          <article
            key={asset.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData('application/x-chargerent-media', asset.id);
              event.dataTransfer.setData('text/plain', asset.name);
            }}
          >
            <MediaThumb asset={asset} className="cmw-library-thumb" />
            <span><strong title={asset.name}>{asset.name}</strong><small>{prettyBytes(asset.bytes)}</small></span>
            <span className="cmw-drag-hint">Drag</span>
          </article>
        ))}
        {!filteredLibrary.length && <div className="cmw-library-empty"><CloudArrowUpIcon /><strong>No {mediaType === 'video' ? 'videos' : 'images'} yet</strong><span>Use Upload inside a preview section to add the first one.</span></div>}
      </div>
      {missingZones.length > 0 && <p className="cmw-inline-note">Fill {missingZones.length} remaining section{missingZones.length === 1 ? '' : 's'} in the preview to continue.</p>}
    </div>,
    <div className="cmw-step-body" key="kiosks">
      {mediaType === 'brand' && selectedKiosks.some(id=>kioskDetails.find(device=>device.stationId===id)?.inventory?.media?.supportsStationBackground !== true) && <p role="status" className="cmw-inline-note">Update the selected station apps to enable automatic owner backgrounds before publishing.</p>}
      <span className="cmw-kicker">STEP 5 OF 5</span>
      <h3>Pick the kiosks</h3>
      <p>Only enrolled Chargerent media apps belonging to {clientId} appear here. Phones and Besiter players are excluded.</p>
      {selectedKiosks.some(id => !kioskDetails.some(device => device.stationId === id)) && <p role="alert" className="cmw-inline-note">Some saved kiosks are no longer eligible for this client. Remove them before publishing. <button type="button" onClick={() => setSelectedKiosks(ids => ids.filter(id => kioskDetails.some(device => device.stationId === id)))}>Remove unavailable kiosks</button></p>}
      <div className="cmw-kiosk-toolbar">
        <span>{selectedKiosks.length} selected</span>
        <button type="button" onClick={() => setSelectedKiosks(kioskDetails.map((device) => device.stationId))}>Select all</button>
        <button type="button" onClick={() => setSelectedKiosks([])}>Clear</button>
      </div>
      <div className="cmw-kiosk-list">
        {kioskDetails.map((device) => {
          const selected = selectedKiosks.includes(device.stationId);
          const online = getPhoneConnectionState(device, now) === 'online';
          const delivery = published?.stationIds?.includes(device.stationId) ? deliveryByStation[device.stationId] : null;
          const location = device.kiosk?.info?.location || device.kiosk?.info?.place || device.kiosk?.info?.client || device.displayName;
          return (
            <label key={device.id} className={selected ? 'is-selected' : ''}>
              <input type="checkbox" checked={selected} onChange={() => setSelectedKiosks((current) => selected ? current.filter((id) => id !== device.stationId) : [...current, device.stationId])} />
              <span className="cmw-kiosk-icon"><PlayIcon /></span>
              <span><strong>{device.stationId}</strong><small>{location || 'Chargerent media kiosk'}</small></span>
              <i
                className={delivery ? `cmw-status-pill is-${delivery.state}` : (online ? 'is-online' : '')}
                data-campaign-status={delivery?.state || 'not-published'}
                title={delivery?.message || (delivery?.lastSeen ? `Last report ${new Date(delivery.lastSeen).toLocaleString()}` : '')}
              >
                {delivery?.label || (online ? 'Online' : 'Offline')}
              </i>
            </label>
          );
        })}
        {!kioskDetails.length && <div className="cmw-kiosk-empty">No enrolled Chargerent media kiosks are available for this account.</div>}
      </div>
      {published && <div className="cmw-published"><CheckIcon /><span><strong>Campaign published</strong><small>Revision {published.revision} · {deliverySummary.playing || 0} playing · {deliverySummary.downloading || 0} downloading · {(deliverySummary.downloaded || 0) + (deliverySummary.waiting || 0)} ready or waiting</small></span></div>}
      {deliveryError && <p className="cmw-inline-note">{deliveryError}</p>}
    </div>,
  ];

  if (!campaignClientId(clientId)) return <div className="cmw-error">Select a client before creating a campaign.</div>;
  if (loading) return <div className="cmw-loading"><span /><strong>Loading campaign builder…</strong></div>;
  if (loadError) return <div className="cmw-error"><strong>Campaign builder unavailable</strong><p>{loadError}</p></div>;

  return (
    <div className="cmw-app" data-media-campaign-wizard="true">
      <div className="cmw-editor-heading"><div><strong>{editingId ? 'Edit campaign' : 'New campaign'} · {clientId}</strong><p>{dirty ? 'Unsaved changes' : 'Saved'} · Changes reach kiosks only when published.</p></div><button type="button" onClick={onCancel} disabled={publishing || Boolean(upload)}>Back to campaigns</button></div>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={mediaType === 'video' ? 'video/mp4,video/quicktime,.mp4,.mov' : 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'}
        onChange={(event) => uploadFiles(uploadZone.current, event.target.files)}
      />
      <div className="cmw-progress" aria-label="Campaign setup progress">
        {STEPS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={`${index === step ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`}
            onClick={() => index <= step && setStep(index)}
            disabled={index > step}
          >
            <span>{index < step ? <CheckIcon /> : index + 1}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </div>
      {reviewing && <div className="cmw-review" role="region" aria-label="Review campaign publication"><h3>Publish {campaignName} for {clientId}?</h3><p>Update {selectedKiosks.join(', ')}. {Object.keys(replacements).length ? `This replaces another campaign on ${Object.keys(replacements).join(', ')}.` : 'The selected kiosks will receive this version.'}</p><button type="button" className="cmw-next" disabled={publishing} onClick={() => persist(true)}>{publishing ? 'Publishing…' : 'Publish changes'}</button><button type="button" disabled={publishing} onClick={() => setReviewing(false)}>Keep editing</button></div>}
      <div className="cmw-workspace">
        <section className="cmw-slider-column">
          <div className="cmw-slider-window">
            <div className="cmw-slider-track" style={{ transform: `translateX(-${step * 100}%)` }}>
              {stepContent.map((content, index) => <div className="cmw-slide" key={STEPS[index].key} aria-hidden={step !== index}>{content}</div>)}
            </div>
          </div>
          <footer className="cmw-navigation">
            <button type="button" className="cmw-back" disabled={step === 0 || publishing || Boolean(upload)} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeftIcon /> Back</button>
            {step < STEPS.length - 1
              ? <button type="button" className="cmw-next" disabled={!canContinue || publishing || Boolean(upload)} onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}>Next <ArrowRightIcon /></button>
              : <button type="button" className="cmw-next" disabled={!canContinue || publishing || Boolean(upload) || previewMode} onClick={() => setReviewing(true)}>Review &amp; publish <CloudArrowUpIcon /></button>}
            <button type="button" className="cmw-back" disabled={!canSaveDraft || publishing || (!dirty && Boolean(editingId))} onClick={() => persist(false)}>{publishing ? 'Saving…' : 'Save draft'}</button>
          </footer>
        </section>
        <CampaignPreview
          campaignName={campaignName}
          layout={layout}
          orientation={baseDraft.orientation || 'portrait'}
          mediaType={mediaType}
          ownerBrand={kioskDetails.find(device=>selectedKiosks.includes(device.stationId))?.kiosk?.stationBrand || 'chargerent'}
          zoneMedia={zoneMedia}
          library={library}
          editing={step === 3}
          upload={upload}
          checkoutEnabled={checkoutEnabled}
          onDropAsset={addAsset}
          onUpload={uploadFiles}
          onRemove={removeAsset}
        />
      </div>
    </div>
  );
}
