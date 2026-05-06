import { useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveBoxIcon, TrashIcon } from '@heroicons/react/24/outline';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import ConfirmationModal from '../components/UI/ConfirmationModal.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { filterStationsForClient } from '../utils/helpers.js';

const ALL_LOCATIONS_TAG = 'All Locations';
const UNTAGGED_FILTER_VALUE = '__UNTAGGED__';
const UNTAGGED_FILTER_LABEL = 'Untagged';
const MEDIA_LIST_TIMEOUT_MS = 45000;
const MEDIA_UPLOAD_URL_TIMEOUT_MS = 45000;
const MEDIA_FINALIZE_TIMEOUT_MS = 120000;

function isPdfFile(fileOrAsset) {
  return String(fileOrAsset?.type || fileOrAsset?.contentType || '').trim().toLowerCase() === 'application/pdf';
}

function isSupportedMediaFile(file) {
  const contentType = String(file?.type || '').trim().toLowerCase();
  const lowerName = String(file?.name || '').trim().toLowerCase();

  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType === 'application/pdf' ||
    lowerName.endsWith('.pdf')
  );
}

function resolveUploadContentType(file) {
  const contentType = String(file?.type || '').trim().toLowerCase();
  if (contentType) {
    return contentType;
  }

  const lowerName = String(file?.name || '').trim().toLowerCase();
  if (lowerName.endsWith('.pdf')) {
    return 'application/pdf';
  }

  return 'application/octet-stream';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getUploadPercent(loaded, total) {
  const safeLoaded = Number(loaded || 0);
  const safeTotal = Number(total || 0);

  if (!Number.isFinite(safeTotal) || safeTotal <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((safeLoaded / safeTotal) * 100)));
}

function getKioskClientTag(kiosk) {
  return String(kiosk?.info?.client || kiosk?.info?.clientId || '').trim();
}

function getKioskLocationTag(kiosk) {
  return String(kiosk?.info?.location || '').trim();
}

function normalizeTagKey(value) {
  return String(value || '').trim().toUpperCase();
}

function buildUniqueTagOptions(values) {
  const optionMap = new Map();

  values.forEach((value) => {
    const nextValue = String(value || '').trim();
    if (!nextValue) {
      return;
    }

    const key = normalizeTagKey(nextValue);
    if (!optionMap.has(key)) {
      optionMap.set(key, {
        value: nextValue,
        count: 0,
      });
    }

    optionMap.get(key).count += 1;
  });

  return Array.from(optionMap.values())
    .sort((left, right) => left.value.localeCompare(right.value));
}

function buildClientTagOptions(kiosks) {
  return buildUniqueTagOptions(kiosks.map((kiosk) => getKioskClientTag(kiosk)))
    .map((option) => ({
      value: option.value,
      label: option.count > 1 ? `${option.value} (${option.count} stations)` : option.value,
    }));
}

function buildLocationTagOptions(kiosks, clientTag) {
  if (!clientTag) {
    return [];
  }

  const matchingKiosks = kiosks.filter((kiosk) => (
    getKioskClientTag(kiosk).toUpperCase() === String(clientTag).trim().toUpperCase()
  ));

  const locationOptions = buildUniqueTagOptions(matchingKiosks.map((kiosk) => getKioskLocationTag(kiosk)))
    .map((option) => ({
      value: option.value,
      label: option.count > 1 ? `${option.value} (${option.count} stations)` : option.value,
    }));

  return [
    { value: ALL_LOCATIONS_TAG, label: ALL_LOCATIONS_TAG },
    ...locationOptions,
  ];
}

function mergeTagSelectOptions(...optionGroups) {
  const optionMap = new Map();

  optionGroups.flat().forEach((option) => {
    const value = String(option?.value || '').trim();
    if (!value) {
      return;
    }

    const key = value === UNTAGGED_FILTER_VALUE ? value : normalizeTagKey(value);
    if (!optionMap.has(key)) {
      optionMap.set(key, {
        value,
        label: String(option?.label || value).trim() || value,
      });
    }
  });

  return Array.from(optionMap.values())
    .sort((left, right) => {
      if (left.value === UNTAGGED_FILTER_VALUE) return 1;
      if (right.value === UNTAGGED_FILTER_VALUE) return -1;
      return left.label.localeCompare(right.label);
    });
}

function uploadFileWithProgress({ uploadUrl, file, contentType, onProgress, onRequestReady }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', contentType);
    onRequestReady?.(request);

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      onProgress(event.loaded, event.total || file.size);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        resolve();
        return;
      }

      reject(new Error(`Upload failed for ${file.name} (${request.status})`));
    });

    request.addEventListener('error', () => {
      reject(new Error(`Upload failed for ${file.name}.`));
    });

    request.addEventListener('abort', () => {
      reject(new Error(`Upload aborted for ${file.name}.`));
    });

    request.send(file);
  });
}

function UploadProgressRows({ items, onCancelUpload }) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const getStatusLabel = (item) => {
    switch (item.status) {
      case 'waiting':
        return 'Waiting';
      case 'preparing':
        return 'Preparing';
      case 'uploading':
        return `Uploading ${item.progress}%`;
      case 'finalizing':
        return 'Finalizing';
      case 'complete':
        return 'Complete';
      case 'canceled':
        return item.errorMessage || 'Canceled';
      case 'error':
        return item.errorMessage || 'Upload failed';
      default:
        return '';
    }
  };

  const getBarClassName = (item) => {
    if (item.status === 'error') return 'bg-red-500';
    if (item.status === 'canceled') return 'bg-amber-400';
    if (item.status === 'complete') return 'bg-emerald-500';
    return 'bg-emerald-400';
  };

  const canCancelItem = (item) => (
    item.status === 'waiting' ||
    item.status === 'preparing' ||
    item.status === 'uploading' ||
    item.status === 'finalizing'
  );

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Upload Progress</h3>
        <p className="mt-1 text-xs text-gray-500">Each file updates as it uploads to storage.</p>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                <p className={`mt-1 text-xs ${item.status === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                  {getStatusLabel(item)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-gray-500">
                  <p>{item.progress}%</p>
                  <p>{formatBytes(item.size)}</p>
                </div>
                {canCancelItem(item) && (
                  <button
                    type="button"
                    onClick={() => onCancelUpload?.(item.id)}
                    className="mt-2 text-xs font-semibold text-red-600 hover:text-red-700"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${getBarClassName(item)}`}
                style={{ width: `${item.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadMetadataModal({
  isOpen,
  files,
  uploadVisibility,
  clientOptions,
  locationOptions,
  selectedClientTag,
  selectedLocationTag,
  onClientTagChange,
  onLocationTagChange,
  onClose,
  onConfirm,
}) {
  if (!isOpen) {
    return null;
  }

  const safeFiles = Array.isArray(files) ? files : [];
  const confirmDisabled = !selectedClientTag || !selectedLocationTag;
  const fileSummary = safeFiles.slice(0, 5);
  const remainingFileCount = Math.max(0, safeFiles.length - fileSummary.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-bold text-gray-900">Tag Upload Batch</h2>
        <p className="text-sm text-gray-600">
          Choose the client and location tags for these files before upload. You can use these tags to filter the library later.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Upload scope: {uploadVisibility === 'global' ? 'Global library' : 'Your client library'}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="upload-client-tag" className="mb-1 block text-sm font-semibold text-gray-700">
              Client
            </label>
            <select
              id="upload-client-tag"
              value={selectedClientTag}
              onChange={(event) => onClientTagChange(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">Select client</option>
              {clientOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="upload-location-tag" className="mb-1 block text-sm font-semibold text-gray-700">
              Location
            </label>
            <select
              id="upload-location-tag"
              value={selectedLocationTag}
              onChange={(event) => onLocationTagChange(event.target.value)}
              disabled={!selectedClientTag}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{selectedClientTag ? 'Select location' : 'Select client first'}</option>
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {safeFiles.length} file{safeFiles.length === 1 ? '' : 's'} selected
          </p>
          <div className="mt-2 space-y-1">
            {fileSummary.map((file, index) => (
              <p key={`${file.name}-${file.size}-${index}`} className="truncate text-sm text-gray-700">
                {file.name}
              </p>
            ))}
            {remainingFileCount > 0 && (
              <p className="text-sm text-gray-500">
                +{remainingFileCount} more file{remainingFileCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-300 px-6 py-2 font-semibold text-gray-800 hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="rounded-md bg-emerald-600 px-6 py-2 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Start Upload
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaPreview({ asset }) {
  if (asset.kind === 'image') {
    return (
      <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-gray-100">
        <img
          src={asset.downloadUrl}
          alt={asset.name}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  if (asset.kind === 'video') {
    return (
      <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-gray-900">
        <video
          src={asset.downloadUrl}
          className="h-full w-full object-contain"
          controls
          preload="metadata"
        />
      </div>
    );
  }

  if (asset.kind === 'pdf' || isPdfFile(asset)) {
    return (
      <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-red-50">
        <div className="flex h-full w-full flex-col items-center justify-center text-center">
          <div className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
            PDF
          </div>
          <p className="mt-3 px-4 text-sm font-medium text-gray-700">PDF file uploaded</p>
          <p className="mt-1 px-4 text-xs text-gray-500">Open file to verify the document.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-gray-100">
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        Preview unavailable
      </div>
    </div>
  );
}

export default function MediaPage({
  onLogout,
  onNavigateToDashboard,
  onNavigateToAdmin,
  currentUser,
  allStationsData,
  t,
}) {
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [status, setStatus] = useState(null);
  const [assetPendingDelete, setAssetPendingDelete] = useState(null);
  const [uploadItems, setUploadItems] = useState([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [uploadClientTag, setUploadClientTag] = useState('');
  const [uploadLocationTag, setUploadLocationTag] = useState('');
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [selectedStationIds, setSelectedStationIds] = useState([]);
  const [assetClientFilter, setAssetClientFilter] = useState('');
  const [assetLocationFilter, setAssetLocationFilter] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const activeUploadRequestsRef = useRef(new Map());
  const canceledUploadIdsRef = useRef(new Set());

  const uploadVisibility = currentUser?.isAdmin ? 'global' : 'client';
  const isUploading = uploadItems.some((item) => (
    item.status === 'waiting' ||
    item.status === 'preparing' ||
    item.status === 'uploading' ||
    item.status === 'finalizing'
  ));

  const eligibleKiosks = useMemo(() => (
    filterStationsForClient(allStationsData, currentUser)
      .filter((kiosk) => kiosk?.isNewSchema === true)
      .filter((kiosk) => String(kiosk?.hardware?.type || '').trim().toUpperCase() === 'CK48')
      .sort((left, right) => String(left.stationid || '').localeCompare(String(right.stationid || '')))
  ), [allStationsData, currentUser]);

  const uploadClientOptions = useMemo(() => buildClientTagOptions(eligibleKiosks), [eligibleKiosks]);

  const uploadLocationOptions = useMemo(
    () => buildLocationTagOptions(eligibleKiosks, uploadClientTag),
    [eligibleKiosks, uploadClientTag],
  );

  const assetClientOptions = useMemo(() => {
    const assetOptions = buildUniqueTagOptions(assets.map((asset) => asset.clientTag))
      .map((option) => ({ value: option.value, label: option.value }));
    const kioskOptions = buildClientTagOptions(eligibleKiosks)
      .map((option) => ({ value: option.value, label: option.value }));
    const untaggedOption = assets.some((asset) => !String(asset.clientTag || '').trim()) ?
      [{ value: UNTAGGED_FILTER_VALUE, label: UNTAGGED_FILTER_LABEL }] :
      [];

    return mergeTagSelectOptions(assetOptions, kioskOptions, untaggedOption);
  }, [assets, eligibleKiosks]);

  const assetLocationOptions = useMemo(() => {
    const matchingAssets = assetClientFilter === UNTAGGED_FILTER_VALUE ?
      assets.filter((asset) => !String(asset.clientTag || '').trim()) :
      (assetClientFilter ?
        assets.filter((asset) => normalizeTagKey(asset.clientTag) === normalizeTagKey(assetClientFilter)) :
        assets);

    const matchingKiosks = assetClientFilter && assetClientFilter !== UNTAGGED_FILTER_VALUE ?
      eligibleKiosks.filter((kiosk) => normalizeTagKey(getKioskClientTag(kiosk)) === normalizeTagKey(assetClientFilter)) :
      (assetClientFilter === UNTAGGED_FILTER_VALUE ? [] : eligibleKiosks);

    const assetOptions = buildUniqueTagOptions(matchingAssets.map((asset) => asset.locationTag))
      .map((option) => ({ value: option.value, label: option.value }));
    const kioskOptions = buildUniqueTagOptions(matchingKiosks.map((kiosk) => getKioskLocationTag(kiosk)))
      .map((option) => ({ value: option.value, label: option.value }));
    const untaggedOption = matchingAssets.some((asset) => !String(asset.locationTag || '').trim()) ?
      [{ value: UNTAGGED_FILTER_VALUE, label: UNTAGGED_FILTER_LABEL }] :
      [];

    return mergeTagSelectOptions(assetOptions, kioskOptions, untaggedOption);
  }, [assets, eligibleKiosks, assetClientFilter]);

  const filteredAssets = useMemo(() => (
    assets.filter((asset) => {
      const assetClientTag = String(asset.clientTag || '').trim();
      const assetLocationTag = String(asset.locationTag || '').trim();

      if (assetClientFilter === UNTAGGED_FILTER_VALUE) {
        if (assetClientTag) {
          return false;
        }
      } else if (assetClientFilter && normalizeTagKey(assetClientTag) !== normalizeTagKey(assetClientFilter)) {
        return false;
      }

      if (assetLocationFilter === UNTAGGED_FILTER_VALUE) {
        if (assetLocationTag) {
          return false;
        }
      } else if (assetLocationFilter && normalizeTagKey(assetLocationTag) !== normalizeTagKey(assetLocationFilter)) {
        return false;
      }

      return true;
    })
  ), [assets, assetClientFilter, assetLocationFilter]);

  const selectedAssets = useMemo(() => (
    selectedAssetIds
      .map((assetId) => assets.find((asset) => asset.id === assetId))
      .filter(Boolean)
  ), [assets, selectedAssetIds]);

  const selectedKioskCount = selectedStationIds.length;

  const loadAssets = async () => {
    setLoadingAssets(true);
    try {
      const payload = await callFunctionWithAuth('media_listAssets', {}, {
        timeoutMs: MEDIA_LIST_TIMEOUT_MS,
        timeoutMessage: 'Loading media assets took too long. Please refresh and try again.',
      });
      setAssets(Array.isArray(payload?.assets) ? payload.assets : []);
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Unable to load media assets.',
      });
    } finally {
      setLoadingAssets(false);
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  useEffect(() => {
    setSelectedStationIds((prev) => prev.filter((stationid) => (
      eligibleKiosks.some((kiosk) => kiosk.stationid === stationid)
    )));
  }, [eligibleKiosks]);

  useEffect(() => {
    if (uploadClientOptions.length === 0) {
      if (uploadClientTag) {
        setUploadClientTag('');
      }
      return;
    }

    const hasSelectedClient = uploadClientOptions.some((option) => option.value === uploadClientTag);
    if (!hasSelectedClient && uploadClientOptions.length === 1) {
      setUploadClientTag(uploadClientOptions[0].value);
    }
  }, [uploadClientOptions, uploadClientTag]);

  useEffect(() => {
    if (!uploadClientTag) {
      if (uploadLocationTag) {
        setUploadLocationTag('');
      }
      return;
    }

    if (uploadLocationOptions.length === 0) {
      if (uploadLocationTag) {
        setUploadLocationTag('');
      }
      return;
    }

    const hasSelectedLocation = uploadLocationOptions.some((option) => option.value === uploadLocationTag);
    if (!hasSelectedLocation) {
      setUploadLocationTag(uploadLocationOptions[0].value);
    }
  }, [uploadClientTag, uploadLocationOptions, uploadLocationTag]);

  useEffect(() => {
    if (assetClientFilter && !assetClientOptions.some((option) => (
      option.value === assetClientFilter ||
      normalizeTagKey(option.value) === normalizeTagKey(assetClientFilter)
    ))) {
      setAssetClientFilter('');
    }
  }, [assetClientFilter, assetClientOptions]);

  useEffect(() => {
    if (assetLocationFilter && !assetLocationOptions.some((option) => (
      option.value === assetLocationFilter ||
      normalizeTagKey(option.value) === normalizeTagKey(assetLocationFilter)
    ))) {
      setAssetLocationFilter('');
    }
  }, [assetLocationFilter, assetLocationOptions]);

  const toggleAssetSelection = (assetId) => {
    setSelectedAssetIds((prev) => (
      prev.includes(assetId) ?
        prev.filter((id) => id !== assetId) :
        [...prev, assetId]
    ));
  };

  const moveSelectedAsset = (assetId, direction) => {
    setSelectedAssetIds((prev) => {
      const index = prev.indexOf(assetId);
      if (index === -1) return prev;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const toggleStationSelection = (stationid) => {
    setSelectedStationIds((prev) => (
      prev.includes(stationid) ?
        prev.filter((value) => value !== stationid) :
        [...prev, stationid]
    ));
  };

  const handleSelectAllKiosks = () => {
    setSelectedStationIds(eligibleKiosks.map((kiosk) => kiosk.stationid));
  };

  const handleClearKioskSelection = () => {
    setSelectedStationIds([]);
  };

  const updateUploadItem = (uploadId, patch) => {
    setUploadItems((prev) => prev.map((item) => {
      if (item.id !== uploadId) {
        return item;
      }

      const nextPatch = typeof patch === 'function' ? patch(item) : patch;
      return { ...item, ...nextPatch };
    }));
  };

  const removeUploadItem = (uploadId) => {
    setUploadItems((prev) => prev.filter((item) => item.id !== uploadId));
  };

  const upsertUploadedAsset = (nextAsset) => {
    if (!nextAsset?.id) {
      return;
    }

    setAssets((prev) => [
      nextAsset,
      ...prev.filter((asset) => asset.id !== nextAsset.id),
    ]);
  };

  const handleCancelUpload = (uploadId) => {
    canceledUploadIdsRef.current.add(uploadId);

    const activeRequest = activeUploadRequestsRef.current.get(uploadId);
    if (activeRequest) {
      activeRequest.abort();
    }

    updateUploadItem(uploadId, (item) => ({
      status: 'canceled',
      errorMessage: 'Canceled by user.',
      progress: item.status === 'waiting' ? 0 : item.progress,
    }));
  };

  const validateUploadBatch = (files) => {
    if (files.length === 0) {
      return null;
    }

    if (isUploading) {
      return 'Wait for the current upload to finish before starting another upload.';
    }

    const invalidFile = files.find((file) => !isSupportedMediaFile(file));
    if (invalidFile) {
      return `${invalidFile.name} is not an image, video, or PDF file.`;
    }

    if (uploadClientOptions.length === 0) {
      return 'No eligible CK48 clients were found for tagging uploads.';
    }

    return null;
  };

  const openUploadMetadataModal = (files) => {
    if (files.length === 0) {
      return;
    }

    const validationError = validateUploadBatch(files);
    if (validationError) {
      setStatus({
        state: 'error',
        message: validationError,
      });
      return;
    }

    const nextClientTag = uploadClientOptions.some((option) => option.value === uploadClientTag) ?
      uploadClientTag :
      (uploadClientOptions[0]?.value || '');
    const nextLocationOptions = buildLocationTagOptions(eligibleKiosks, nextClientTag);
    const nextLocationTag = nextLocationOptions.some((option) => option.value === uploadLocationTag) ?
      uploadLocationTag :
      (nextLocationOptions[0]?.value || '');

    setUploadClientTag(nextClientTag);
    setUploadLocationTag(nextLocationTag);
    setPendingUploadFiles(files);
  };

  const closeUploadMetadataModal = () => {
    if (isUploading) {
      return;
    }

    setPendingUploadFiles([]);
  };

  const handleUploadClientTagChange = (nextClientTag) => {
    setUploadClientTag(nextClientTag);

    const nextLocationOptions = buildLocationTagOptions(eligibleKiosks, nextClientTag);
    const nextLocationTag = nextLocationOptions.some((option) => option.value === uploadLocationTag) ?
      uploadLocationTag :
      (nextLocationOptions[0]?.value || '');
    setUploadLocationTag(nextLocationTag);
  };

  const uploadFiles = async (files, tags) => {
    if (files.length === 0) return;

    const validationError = validateUploadBatch(files);
    if (validationError) {
      setStatus({
        state: 'error',
        message: validationError,
      });
      return;
    }

    const clientTag = String(tags?.clientTag || '').trim();
    const locationTag = String(tags?.locationTag || '').trim();
    if (!clientTag || !locationTag) {
      setStatus({
        state: 'error',
        message: 'Choose both a client and a location tag before uploading.',
      });
      return;
    }

    const nextUploadItems = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      size: Number(file.size || 0),
      progress: 0,
      status: 'waiting',
      errorMessage: '',
    }));
    setUploadItems(nextUploadItems);
    canceledUploadIdsRef.current = new Set();
    activeUploadRequestsRef.current = new Map();

    setStatus({
      state: 'sending',
      message: `Uploading ${files.length} media file${files.length === 1 ? '' : 's'}...`,
    });

    let completedCount = 0;
    let canceledCount = 0;
    let failedCount = 0;

    try {
      for (const [index, file] of files.entries()) {
        const uploadItem = nextUploadItems[index];
        const uploadId = uploadItem.id;

        if (canceledUploadIdsRef.current.has(uploadId)) {
          canceledCount += 1;
          continue;
        }

        const contentType = resolveUploadContentType(file);
        updateUploadItem(uploadId, {
          status: 'preparing',
          progress: 0,
          errorMessage: '',
        });

        const uploadConfig = await callFunctionWithAuth('media_createUploadUrl', {
          fileName: file.name,
          contentType,
          size: file.size,
          visibility: uploadVisibility,
        }, {
          timeoutMs: MEDIA_UPLOAD_URL_TIMEOUT_MS,
          timeoutMessage: `Preparing ${file.name} took too long. Try that file again.`,
        });

        if (canceledUploadIdsRef.current.has(uploadId)) {
          updateUploadItem(uploadId, {
            status: 'canceled',
            errorMessage: 'Canceled by user.',
          });
          canceledCount += 1;
          continue;
        }

        try {
          updateUploadItem(uploadId, { status: 'uploading' });

          await uploadFileWithProgress({
            uploadUrl: uploadConfig.uploadUrl,
            file,
            contentType,
            onRequestReady: (request) => {
              activeUploadRequestsRef.current.set(uploadId, request);
            },
            onProgress: (loaded, total) => {
              updateUploadItem(uploadId, {
                status: 'uploading',
                progress: getUploadPercent(loaded, total),
              });
            },
          });

          activeUploadRequestsRef.current.delete(uploadId);

          if (canceledUploadIdsRef.current.has(uploadId)) {
            updateUploadItem(uploadId, {
              status: 'canceled',
              errorMessage: 'Canceled by user.',
            });
            canceledCount += 1;
            continue;
          }

          updateUploadItem(uploadId, {
            status: 'finalizing',
            progress: 100,
          });

          const finalizeAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
          if (finalizeAbortController) {
            activeUploadRequestsRef.current.set(uploadId, finalizeAbortController);
          }

          const finalizePayload = await callFunctionWithAuth('media_finalizeUpload', {
            assetId: uploadConfig.assetId,
            fileName: file.name,
            storagePath: uploadConfig.storagePath,
            bucketName: uploadConfig.bucketName,
            contentType,
            size: file.size,
            visibility: uploadConfig.visibility,
            clientTag,
            locationTag,
          }, {
            timeoutMs: MEDIA_FINALIZE_TIMEOUT_MS,
            timeoutMessage: `Finalizing ${file.name} took too long. Please retry that file.`,
            abortController: finalizeAbortController,
            abortMessage: `Upload canceled for ${file.name}.`,
          });

          activeUploadRequestsRef.current.delete(uploadId);

          upsertUploadedAsset(finalizePayload?.asset);

          updateUploadItem(uploadId, {
            status: 'complete',
            progress: 100,
          });
          globalThis.setTimeout(() => {
            removeUploadItem(uploadId);
          }, 500);
          completedCount += 1;
        } catch (error) {
          activeUploadRequestsRef.current.delete(uploadId);

          if (canceledUploadIdsRef.current.has(uploadId) || /aborted/i.test(String(error?.message || ''))) {
            updateUploadItem(uploadId, (item) => ({
              status: 'canceled',
              errorMessage: 'Canceled by user.',
              progress: item.progress,
            }));
            canceledCount += 1;
            continue;
          }

          updateUploadItem(uploadId, (item) => ({
            status: 'error',
            errorMessage: error?.message || 'Media upload failed.',
            progress: item.progress,
          }));
          failedCount += 1;
          continue;
        }
      }

      activeUploadRequestsRef.current = new Map();
      if (failedCount > 0) {
        const summary = [
          `Uploaded ${completedCount} file${completedCount === 1 ? '' : 's'}.`,
          `${failedCount} failed.`,
          canceledCount > 0 ? `${canceledCount} canceled.` : '',
        ].filter(Boolean).join(' ');
        setStatus({
          state: 'error',
          message: summary,
        });
      } else {
        setStatus({
          state: 'success',
          message: canceledCount > 0 ?
            `Uploaded ${completedCount} file${completedCount === 1 ? '' : 's'}. ${canceledCount} canceled.` :
            `Uploaded ${completedCount} media file${completedCount === 1 ? '' : 's'}.`,
        });
      }
    } catch (error) {
      activeUploadRequestsRef.current = new Map();
      setStatus({
        state: 'error',
        message: error?.message || 'Media upload failed.',
      });
    }
  };

  const handleUploadFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    openUploadMetadataModal(files);
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isUploading) return;
    setIsDragActive(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isUploading) return;
    setIsDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setIsDragActive(false);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    if (isUploading) {
      setStatus({
        state: 'error',
        message: 'Wait for the current upload to finish before starting another upload.',
      });
      return;
    }
    openUploadMetadataModal(Array.from(event.dataTransfer?.files || []));
  };

  const handleConfirmUploadMetadata = async () => {
    if (pendingUploadFiles.length === 0) {
      return;
    }

    const filesToUpload = pendingUploadFiles;
    setPendingUploadFiles([]);
    await uploadFiles(filesToUpload, {
      clientTag: uploadClientTag,
      locationTag: uploadLocationTag,
    });
  };

  const handleArchiveAsset = async (assetId) => {
    const targetAsset = assets.find((asset) => asset.id === assetId);
    if (!targetAsset) return;

    setStatus({
      state: 'sending',
      message: `Archiving ${targetAsset.name}...`,
    });

    try {
      await callFunctionWithAuth('media_archiveAsset', { assetId });
      setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
      setSelectedAssetIds((prev) => prev.filter((id) => id !== assetId));
      setStatus({
        state: 'success',
        message: `${targetAsset.name} archived.`,
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Unable to archive asset.',
      });
    }
  };

  const handleDeleteAssetRequest = (assetId) => {
    const targetAsset = assets.find((asset) => asset.id === assetId);
    if (!targetAsset) return;
    setAssetPendingDelete(targetAsset);
  };

  const handleDeleteAssetConfirm = async () => {
    const targetAsset = assetPendingDelete;
    if (!targetAsset) return;
    setAssetPendingDelete(null);

    setStatus({
      state: 'sending',
      message: `Deleting ${targetAsset.name} permanently...`,
    });

    try {
      await callFunctionWithAuth('media_deleteAsset', { assetId: targetAsset.id });
      setAssets((prev) => prev.filter((asset) => asset.id !== targetAsset.id));
      setSelectedAssetIds((prev) => prev.filter((id) => id !== targetAsset.id));
      setStatus({
        state: 'success',
        message: `${targetAsset.name} deleted permanently.`,
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Unable to delete asset.',
      });
    }
  };

  const handleAssignPlaylist = async () => {
    if (selectedAssetIds.length === 0) {
      setStatus({ state: 'error', message: 'Select at least one media asset first.' });
      return;
    }

    if (selectedStationIds.length === 0) {
      setStatus({ state: 'error', message: 'Select at least one CK48 station first.' });
      return;
    }

    setStatus({
      state: 'sending',
      message: `Assigning ${selectedAssetIds.length} asset${selectedAssetIds.length === 1 ? '' : 's'} to ${selectedStationIds.length} station${selectedStationIds.length === 1 ? '' : 's'}...`,
    });

    try {
      const payload = await callFunctionWithAuth('media_assignPlaylist', {
        stationids: selectedStationIds,
        assetIds: selectedAssetIds,
        loop: true,
        setUiMode: true,
        active: true,
      });
      setStatus({
        state: 'success',
        message: `Updated ${payload?.updatedCount || 0} station${payload?.updatedCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Unable to assign media.',
      });
    }
  };

  const handleClearMedia = async () => {
    if (selectedStationIds.length === 0) {
      setStatus({ state: 'error', message: 'Select at least one CK48 station first.' });
      return;
    }

    setStatus({
      state: 'sending',
      message: `Clearing media from ${selectedStationIds.length} station${selectedStationIds.length === 1 ? '' : 's'}...`,
    });

    try {
      const payload = await callFunctionWithAuth('media_assignPlaylist', {
        stationids: selectedStationIds,
        assetIds: [],
        active: false,
        setUiMode: false,
      });
      setStatus({
        state: 'success',
        message: `Cleared media on ${payload?.updatedCount || 0} station${payload?.updatedCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error?.message || 'Unable to clear kiosk media.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <UploadMetadataModal
        isOpen={pendingUploadFiles.length > 0}
        files={pendingUploadFiles}
        uploadVisibility={uploadVisibility}
        clientOptions={uploadClientOptions}
        locationOptions={uploadLocationOptions}
        selectedClientTag={uploadClientTag}
        selectedLocationTag={uploadLocationTag}
        onClientTagChange={handleUploadClientTagChange}
        onLocationTagChange={setUploadLocationTag}
        onClose={closeUploadMetadataModal}
        onConfirm={handleConfirmUploadMetadata}
      />
      <ConfirmationModal
        isOpen={!!assetPendingDelete}
        onClose={() => setAssetPendingDelete(null)}
        onConfirm={handleDeleteAssetConfirm}
        details={assetPendingDelete ? {
          title: 'Delete Media Permanently',
          confirmationText: `Delete ${assetPendingDelete.name} permanently? This also removes it from any kiosk playlists using it.`,
        } : null}
        t={t}
      />
      <CommandStatusToast status={status} onDismiss={() => setStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Media Library</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onNavigateToDashboard}
              className="rounded-md bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              title={t('back_to_dashboard')}
            >
              Dashboard
            </button>
            <button
              onClick={onNavigateToAdmin}
              className="rounded-md bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-200"
            >
              Admin
            </button>
            <button
              onClick={onLogout}
              className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
              title={t('logout')}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-screen-2xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.3fr_1fr] lg:px-8">
        <section className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow-md">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Upload Media</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Upload images, videos, or PDFs to Firebase Storage for CK48 station playlists.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Upload scope: {uploadVisibility === 'global' ? 'Global library' : 'Your client library'}
                </p>
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isUploading) {
                  fileInputRef.current?.click();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!isUploading) {
                    fileInputRef.current?.click();
                  }
                }
              }}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`mt-5 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                isDragActive ?
                  'border-emerald-500 bg-emerald-50' :
                  'border-gray-300 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50/60'
              } ${isUploading ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,application/pdf,.pdf"
                multiple
                onChange={handleUploadFiles}
              />
              <p className="text-base font-semibold text-gray-900">
                {isUploading ? 'Upload in progress...' : (isDragActive ? 'Drop files to upload' : 'Drag and drop files here')}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                {isUploading ? 'Please wait for the current upload to finish.' : 'or click to browse for images, videos, and PDFs'}
              </p>
              <p className="mt-3 text-xs text-gray-500">
                Supported formats: images, videos, and PDF files.
              </p>
            </div>

            <UploadProgressRows items={uploadItems} onCancelUpload={handleCancelUpload} />
          </div>

          <div className="rounded-xl bg-white p-6 shadow-md">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">Media Assets</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Select the files you want in the playlist, then arrange them on the right.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Filter the library by upload tags to find the right client and location faster.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Client Filter
                  </span>
                  <select
                    value={assetClientFilter}
                    onChange={(event) => setAssetClientFilter(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 sm:min-w-[11rem]"
                  >
                    <option value="">All clients</option>
                    {assetClientOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Location Filter
                  </span>
                  <select
                    value={assetLocationFilter}
                    onChange={(event) => setAssetLocationFilter(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 sm:min-w-[11rem]"
                  >
                    <option value="">All locations</option>
                    {assetLocationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setAssetClientFilter('');
                    setAssetLocationFilter('');
                  }}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Clear Filters
                </button>
                <button
                  type="button"
                  onClick={loadAssets}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Refresh
                </button>
              </div>
            </div>

            {loadingAssets ? (
              <div className="flex min-h-[14rem] items-center justify-center">
                <LoadingSpinner t={t} />
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                No media assets yet. Upload your first image, video, or PDF to get started.
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                No media assets match the current client and location filters.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredAssets.map((asset) => {
                  const isSelected = selectedAssetIds.includes(asset.id);
                  const canArchive = currentUser?.isAdmin || asset.visibility !== 'global';

                  return (
                    <article
                      key={asset.id}
                      className={`rounded-xl border p-3 shadow-sm transition ${
                        isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <MediaPreview asset={asset} />
                      <div className="mt-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-gray-900">{asset.name}</h3>
                            <p className="mt-1 text-xs text-gray-500">
                              {asset.kind.toUpperCase()} · {formatBytes(asset.size)} · {asset.visibility}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {asset.clientTag && (
                                <span className="rounded-full bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-700">
                                  Client: {asset.clientTag}
                                </span>
                              )}
                              {asset.locationTag && (
                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                  Location: {asset.locationTag}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleAssetSelection(asset.id)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                              isSelected ?
                                'bg-emerald-600 text-white hover:bg-emerald-700' :
                                'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </button>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <a
                            href={asset.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                          >
                            Open file
                          </a>
                          {canArchive && (
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => handleArchiveAsset(asset.id)}
                                className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                title="Archive asset"
                                aria-label="Archive asset"
                              >
                                <ArchiveBoxIcon className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAssetRequest(asset.id)}
                                className="rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                                title="Delete asset permanently"
                                aria-label="Delete asset permanently"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-xl bg-white p-6 shadow-md">
            <h2 className="text-lg font-semibold text-gray-900">Playlist</h2>
            <p className="mt-1 text-sm text-gray-600">
              The selected asset order becomes the playback order on each kiosk.
            </p>

            {selectedAssets.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                No assets selected yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedAssets.map((asset, index) => (
                  <div key={asset.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                          Item {index + 1}
                        </p>
                        <p className="truncate text-sm font-semibold text-gray-900">{asset.name}</p>
                        <p className="mt-1 text-xs text-gray-500">{asset.kind.toUpperCase()} · {formatBytes(asset.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleAssetSelection(asset.id)}
                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => moveSelectedAsset(asset.id, 'up')}
                        className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-300"
                      >
                        Move Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSelectedAsset(asset.id, 'down')}
                        className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-300"
                      >
                        Move Down
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

          <div className="rounded-xl bg-white p-6 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Target Stations</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Select stations to assign assets to. Offline CK48 kiosks will load their assigned media when they come back online.
                </p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{selectedKioskCount} selected</p>
                <p>{eligibleKiosks.length} available</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSelectAllKiosks}
                className="rounded-md bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleClearKioskSelection}
                className="rounded-md bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200"
              >
                Clear Selection
              </button>
            </div>

            {eligibleKiosks.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                No CK48 stations were found for this account.
              </div>
            ) : (
              <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {eligibleKiosks.map((kiosk) => {
                  const isSelected = selectedStationIds.includes(kiosk.stationid);
                  const currentPlaylist = Array.isArray(kiosk?.media?.playlist) ? kiosk.media.playlist : [];
                  const currentPlaylistCount = currentPlaylist.length;
                  const currentPlaylistNames = currentPlaylist
                    .map((asset) => String(asset?.name || asset?.assetId || '').trim())
                    .filter(Boolean)
                    .join(', ');
                  const currentPlaylistLabel = kiosk?.media?.active && currentPlaylistCount > 0 ?
                    `${currentPlaylistCount} asset${currentPlaylistCount === 1 ? '' : 's'} assigned${currentPlaylistNames ? ` · ${currentPlaylistNames}` : ''}` :
                    'No media assigned';

                  return (
                    <label
                      key={kiosk.stationid}
                      className={`block rounded-lg border p-3 ${
                        isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleStationSelection(kiosk.stationid)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{kiosk.stationid}</p>
                              <p className="text-xs text-gray-500">
                                {kiosk.info?.location || 'Unknown location'} · {kiosk.info?.place || 'Unknown place'}
                              </p>
                            </div>
                            <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-gray-600">
                              {kiosk.hardware?.type || 'CK48'}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-xs text-gray-600" title={currentPlaylistLabel}>
                            {currentPlaylistLabel}
                          </p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-6 space-y-3 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={handleAssignPlaylist}
                disabled={selectedAssetIds.length === 0 || selectedStationIds.length === 0}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Assign Playlist
              </button>
              <button
                type="button"
                onClick={handleClearMedia}
                disabled={selectedStationIds.length === 0}
                className="w-full rounded-lg bg-gray-200 px-4 py-3 font-semibold text-gray-800 hover:bg-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                Clear Station Media
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
