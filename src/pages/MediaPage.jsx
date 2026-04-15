import { useEffect, useMemo, useRef, useState } from 'react';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import LoadingSpinner from '../components/UI/LoadingSpinner.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';
import { filterStationsForClient } from '../utils/helpers.js';

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

function calculateUploadPercent(uploadedBytes, totalBytes) {
  const uploaded = Number(uploadedBytes || 0);
  const total = Number(totalBytes || 0);

  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((uploaded / total) * 100)));
}

function createUploadProgressState(files) {
  const progressFiles = files.map((file, index) => ({
    id: `${Date.now()}-${index}-${file.name}`,
    name: file.name,
    size: Number(file.size || 0),
    uploadedBytes: 0,
    progressPercent: 0,
    status: 'pending',
    errorMessage: '',
  }));

  return {
    active: progressFiles.length > 0,
    totalFiles: progressFiles.length,
    totalBytes: progressFiles.reduce((sum, file) => sum + file.size, 0),
    uploadedBytes: 0,
    completedFiles: 0,
    files: progressFiles,
  };
}

function uploadFileToSignedUrl({ uploadUrl, file, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(event.loaded, event.total || file.size);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size, file.size);
        resolve(xhr);
        return;
      }

      reject(new Error(`Upload failed for ${file.name} (${xhr.status})`));
    };

    xhr.onerror = () => {
      reject(new Error(`Upload failed for ${file.name}`));
    };

    xhr.onabort = () => {
      reject(new Error(`Upload aborted for ${file.name}`));
    };

    xhr.send(file);
  });
}

function UploadProgressPanel({ uploadProgress }) {
  if (!uploadProgress || uploadProgress.totalFiles === 0) {
    return null;
  }

  const hasError = uploadProgress.files.some((file) => file.status === 'error');
  const isComplete = !uploadProgress.active && !hasError && uploadProgress.completedFiles === uploadProgress.totalFiles;
  const overallPercent = calculateUploadPercent(uploadProgress.uploadedBytes, uploadProgress.totalBytes);
  const overallLabel = hasError ? 'Upload stopped' : (isComplete ? 'Upload complete' : 'Uploading files');

  const getFileTone = (status) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      case 'finalizing':
        return 'bg-sky-500';
      case 'uploading':
        return 'bg-emerald-500';
      default:
        return 'bg-gray-300';
    }
  };

  const getFileStatusLabel = (file) => {
    switch (file.status) {
      case 'preparing':
        return 'Preparing upload...';
      case 'uploading':
        return `Uploading... ${file.progressPercent}%`;
      case 'finalizing':
        return 'Finalizing...';
      case 'complete':
        return 'Complete';
      case 'error':
        return file.errorMessage || 'Upload failed';
      default:
        return 'Waiting...';
    }
  };

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{overallLabel}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {uploadProgress.completedFiles} of {uploadProgress.totalFiles} file{uploadProgress.totalFiles === 1 ? '' : 's'} complete
            {' · '}
            {formatBytes(uploadProgress.uploadedBytes)} of {formatBytes(uploadProgress.totalBytes)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{overallPercent}%</p>
        </div>
      </div>

      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`${hasError ? 'bg-red-500' : 'bg-emerald-500'} h-full rounded-full transition-[width] duration-300`}
          style={{ width: `${overallPercent}%` }}
        />
      </div>

      <div className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1">
        {uploadProgress.files.map((file) => (
          <div key={file.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{file.name}</p>
                <p className={`mt-1 text-xs ${file.status === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                  {getFileStatusLabel(file)}
                </p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{file.progressPercent}%</p>
                <p>{formatBytes(file.size)}</p>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`${getFileTone(file.status)} h-full rounded-full transition-[width] duration-300`}
                style={{ width: `${file.progressPercent}%` }}
              />
            </div>
          </div>
        ))}
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
  const [uploadProgress, setUploadProgress] = useState(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [selectedStationIds, setSelectedStationIds] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const uploadVisibility = currentUser?.isAdmin ? 'global' : 'client';
  const isUploading = uploadProgress?.active === true;

  const eligibleKiosks = useMemo(() => (
    filterStationsForClient(allStationsData, currentUser)
      .filter((kiosk) => kiosk?.isNewSchema === true)
      .filter((kiosk) => String(kiosk?.hardware?.type || '').trim().toUpperCase() === 'CK48')
      .sort((left, right) => String(left.stationid || '').localeCompare(String(right.stationid || '')))
  ), [allStationsData, currentUser]);

  const selectedAssets = useMemo(() => (
    selectedAssetIds
      .map((assetId) => assets.find((asset) => asset.id === assetId))
      .filter(Boolean)
  ), [assets, selectedAssetIds]);

  const selectedKioskCount = selectedStationIds.length;

  const loadAssets = async () => {
    setLoadingAssets(true);
    try {
      const payload = await callFunctionWithAuth('media_listAssets');
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

  const updateUploadProgressFile = (fileIndex, patch) => {
    setUploadProgress((prev) => {
      if (!prev) {
        return prev;
      }

      const nextFiles = prev.files.map((file, index) => {
        if (index !== fileIndex) {
          return file;
        }

        const nextPatch = typeof patch === 'function' ? patch(file) : patch;
        return { ...file, ...nextPatch };
      });

      const uploadedBytes = nextFiles.reduce((sum, file) => sum + Math.min(file.uploadedBytes, file.size), 0);
      const completedFiles = nextFiles.filter((file) => file.status === 'complete').length;
      const active = nextFiles.some((file) => ['preparing', 'uploading', 'finalizing'].includes(file.status));

      return {
        ...prev,
        files: nextFiles,
        uploadedBytes,
        completedFiles,
        active,
      };
    });
  };

  const uploadFiles = async (files) => {
    if (files.length === 0) return;

    if (isUploading) {
      setStatus({
        state: 'error',
        message: 'Wait for the current upload to finish before starting another upload.',
      });
      return;
    }

    const invalidFile = files.find((file) => !isSupportedMediaFile(file));

    if (invalidFile) {
      setStatus({
        state: 'error',
        message: `${invalidFile.name} is not an image, video, or PDF file.`,
      });
      return;
    }

    setStatus(null);
    setUploadProgress(createUploadProgressState(files));

    try {
      for (const [index, file] of files.entries()) {
        const contentType = resolveUploadContentType(file);
        updateUploadProgressFile(index, {
          status: 'preparing',
          uploadedBytes: 0,
          progressPercent: 0,
          errorMessage: '',
        });

        try {
          const uploadConfig = await callFunctionWithAuth('media_createUploadUrl', {
            fileName: file.name,
            contentType,
            size: file.size,
            visibility: uploadVisibility,
          });

          updateUploadProgressFile(index, { status: 'uploading' });

          await uploadFileToSignedUrl({
            uploadUrl: uploadConfig.uploadUrl,
            file,
            contentType,
            onProgress: (uploadedBytes, totalBytes) => {
              updateUploadProgressFile(index, {
                status: 'uploading',
                uploadedBytes,
                progressPercent: calculateUploadPercent(uploadedBytes, totalBytes || file.size),
              });
            },
          });

          updateUploadProgressFile(index, {
            status: 'finalizing',
            uploadedBytes: file.size,
            progressPercent: 100,
          });

          await callFunctionWithAuth('media_finalizeUpload', {
            assetId: uploadConfig.assetId,
            fileName: file.name,
            storagePath: uploadConfig.storagePath,
            bucketName: uploadConfig.bucketName,
            contentType,
            size: file.size,
            visibility: uploadConfig.visibility,
          });

          updateUploadProgressFile(index, {
            status: 'complete',
            uploadedBytes: file.size,
            progressPercent: 100,
          });
        } catch (error) {
          updateUploadProgressFile(index, (currentFile) => ({
            status: 'error',
            errorMessage: error?.message || 'Upload failed.',
            progressPercent: currentFile.progressPercent,
            uploadedBytes: currentFile.uploadedBytes,
          }));
          throw error;
        }
      }

      await loadAssets();
      setUploadProgress((prev) => (
        prev ? { ...prev, active: false } : prev
      ));
      setStatus({
        state: 'success',
        message: `Uploaded ${files.length} media file${files.length === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setUploadProgress((prev) => (
        prev ? { ...prev, active: false } : prev
      ));
      setStatus({
        state: 'error',
        message: error?.message || 'Media upload failed.',
      });
    }
  };

  const handleUploadFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await uploadFiles(files);
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

    await uploadFiles(Array.from(event.dataTransfer?.files || []));
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
      setSelectedAssetIds((prev) => prev.filter((id) => id !== assetId));
      await loadAssets();
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
              } ${isUploading ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
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

            <UploadProgressPanel uploadProgress={uploadProgress} />
          </div>

          <div className="rounded-xl bg-white p-6 shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Media Assets</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Select the files you want in the playlist, then arrange them on the right.
                </p>
              </div>
              <button
                type="button"
                onClick={loadAssets}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Refresh
              </button>
            </div>

            {loadingAssets ? (
              <div className="flex min-h-[14rem] items-center justify-center">
                <LoadingSpinner t={t} />
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                No media assets yet. Upload your first image, video, or PDF to get started.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => {
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
                            <button
                              type="button"
                              onClick={() => handleArchiveAsset(asset.id)}
                              className="text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              Archive
                            </button>
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
