import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase-config';
import CommandStatusToast from '../components/UI/CommandStatusToast.jsx';
import { callFunctionWithAuth } from '../utils/callableRequest.js';

const COUNTRY_OPTIONS = [
  { code: 'CA', label: 'Canada' },
  { code: 'FR', label: 'France' },
  { code: 'US', label: 'United States' },
];

function buildQrUrl(stationid) {
  return stationid ? `https://chargerent.online/stations/qr?id=${stationid}` : '';
}

function normalizeStationId(stationid) {
  return String(stationid || '').trim().toUpperCase();
}

function normalizeModuleId(moduleId) {
  return String(moduleId || '').trim();
}

function extractDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeDecodeValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeMacHex(value) {
  const normalized = String(value || '').trim().replace(/[:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : '';
}

function convertMacToModuleId(value) {
  const normalizedMac = normalizeMacHex(value);
  return normalizedMac ? `1000${BigInt(`0x${normalizedMac}`).toString(10)}` : '';
}

function findUuidParam(value) {
  const match = String(value || '').match(/(?:^|[?&])uuid=([^&#\s]+)/i);
  return match ? safeDecodeValue(match[1]) : '';
}

function findStandalone15Digit(value) {
  const match = String(value || '').match(/(?:^|[^0-9])([0-9]{15})(?![0-9])/);
  return match ? match[1] : '';
}

function isNewKioskStation(stationid) {
  return /^(CA|FR|US)8\d{3}$/.test(normalizeStationId(stationid));
}

function isBindingStationId(stationid) {
  return /^(CA|FR|US)\d{4}$/.test(normalizeStationId(stationid));
}

function getCountryFromStationId(stationid) {
  const normalized = normalizeStationId(stationid);

  if (normalized.startsWith('CA')) return 'CA';
  if (normalized.startsWith('FR')) return 'FR';
  if (normalized.startsWith('US')) return 'US';
  return '';
}

function parseStationQrInput(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return { mode: 'empty', stationid: '' };
  }

  const compactValue = rawValue.replace(/\s+/g, '');
  const idMatch = compactValue.match(/(?:^|[?&])id=([^&#\s]+)/i);

  if (idMatch) {
    try {
      return {
        mode: 'qr',
        stationid: normalizeStationId(decodeURIComponent(idMatch[1])),
      };
    } catch {
      return {
        mode: 'qr',
        stationid: normalizeStationId(idMatch[1]),
      };
    }
  }

  if (/^https?:\/\//i.test(compactValue)) {
    return { mode: 'invalid-url', stationid: '' };
  }

  return {
    mode: 'manual',
    stationid: normalizeStationId(rawValue),
  };
}

function parseModuleScanInput(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return { mode: 'empty', moduleId: '' };
  }

  const decodedValue = safeDecodeValue(rawValue);
  const compactValue = decodedValue.replace(/\s+/g, '');
  const uuidParam = findUuidParam(compactValue);

  if (uuidParam) {
    const parsedUuid = parseModuleScanInput(uuidParam);
    if (parsedUuid.moduleId) {
      return parsedUuid;
    }
  }

  const colonMacMatch = compactValue.match(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/);
  if (colonMacMatch) {
    const macModuleId = convertMacToModuleId(colonMacMatch[0]);
    if (macModuleId) {
      return { mode: 'mac', moduleId: macModuleId };
    }
  }

  const semicolonFields = compactValue.split(';').map((part) => part.trim()).filter(Boolean);
  if (semicolonFields.length > 1) {
    const firstField = semicolonFields[0];
    const firstFieldImei = findStandalone15Digit(firstField);
    if (firstFieldImei) {
      return { mode: 'imei', moduleId: firstFieldImei };
    }

    const firstFieldDigits = extractDigits(firstField);
    if (firstFieldDigits.length >= 15) {
      return { mode: 'imei', moduleId: firstFieldDigits.slice(0, 15) };
    }

    const hexField = semicolonFields.find((part) => /^[0-9A-Fa-f]{12}$/.test(part));
    if (hexField) {
      const macModuleId = convertMacToModuleId(hexField);
      if (macModuleId) {
        return { mode: 'mac', moduleId: macModuleId };
      }
    }
  }

  const imeiValue = findStandalone15Digit(compactValue);
  if (imeiValue) {
    return { mode: 'imei', moduleId: imeiValue };
  }

  const compactDigits = extractDigits(compactValue);
  if (/[^0-9]/.test(compactValue) && compactDigits.length >= 15) {
    return { mode: 'imei', moduleId: compactDigits.slice(-15) };
  }

  const bareHexMatch = compactValue.match(/\b[0-9A-Fa-f]{12}\b/);
  if (bareHexMatch) {
    const macModuleId = convertMacToModuleId(bareHexMatch[0]);
    if (macModuleId) {
      return { mode: 'mac', moduleId: macModuleId };
    }
  }

  if (/^[0-9A-Za-z_-]+$/.test(compactValue)) {
    return { mode: 'literal', moduleId: normalizeModuleId(rawValue) };
  }

  return { mode: 'invalid', moduleId: '' };
}

function moduleIdsEquivalent(left, right) {
  const leftValue = normalizeModuleId(left);
  const rightValue = normalizeModuleId(right);

  if (!leftValue || !rightValue) {
    return false;
  }

  if (leftValue === rightValue) {
    return true;
  }

  const leftParsed = parseModuleScanInput(leftValue);
  const rightParsed = parseModuleScanInput(rightValue);
  const leftCanonical = normalizeModuleId(leftParsed.moduleId || leftValue);
  const rightCanonical = normalizeModuleId(rightParsed.moduleId || rightValue);

  if (!leftCanonical || !rightCanonical) {
    return false;
  }

  if (leftCanonical === rightCanonical) {
    return true;
  }

  if (/^1000\d+$/.test(leftCanonical) && leftCanonical.slice(4) === rightCanonical) {
    return true;
  }

  if (/^1000\d+$/.test(rightCanonical) && rightCanonical.slice(4) === leftCanonical) {
    return true;
  }

  return false;
}

function findBoundModuleById(kiosks, moduleId) {
  const kioskList = Array.isArray(kiosks) ? kiosks : [];

  for (const kiosk of kioskList) {
    const modules = Array.isArray(kiosk?.modules) ? kiosk.modules : [];
    const matchedModule = modules.find((module) => moduleIdsEquivalent(module?.id, moduleId));
    if (matchedModule) {
      return { kiosk, module: matchedModule };
    }
  }

  return null;
}

export default function BindingPage({
  t,
  onLogout,
  onNavigateToDashboard,
  currentUser,
  allStationsData,
}) {
  const isAdminUser = currentUser?.role === 'admin' || currentUser?.username === 'chargerent';
  const canManageBindings = isAdminUser ||
    currentUser?.features?.binding === true ||
    currentUser?.commands?.binding === true;

  const stationQrInputRef = useRef(null);
  const moduleIdInputRef = useRef(null);
  const [stationQrInput, setStationQrInput] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [stationInfo, setStationInfo] = useState({ stationid: '', qrUrl: '' });
  const [pageError, setPageError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [status, setStatus] = useState(null);
  const [firebaseUser, setFirebaseUser] = useState(auth.currentUser || null);
  const [moveSourceStationId, setMoveSourceStationId] = useState('');
  const [moveModuleId, setMoveModuleId] = useState('');
  const [moveDestinationMode, setMoveDestinationMode] = useState('existing');
  const [moveDestinationStationId, setMoveDestinationStationId] = useState('');
  const [moveDestinationCountry, setMoveDestinationCountry] = useState('');
  const [moveDestinationInfo, setMoveDestinationInfo] = useState({ stationid: '', qrUrl: '' });
  const [loadingMoveNextStation, setLoadingMoveNextStation] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user || null);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    stationQrInputRef.current?.focus();
  }, []);

  const ensureSignedIn = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Not signed in');
    }

    await auth.currentUser.getIdToken(true);
    return auth.currentUser;
  }, []);

  const syncStationInfo = useCallback((nextStationid) => {
    const normalizedStationid = normalizeStationId(nextStationid);
    setStationInfo({
      stationid: normalizedStationid,
      qrUrl: buildQrUrl(normalizedStationid),
    });
    setStationQrInput(normalizedStationid);
  }, []);

  const syncMoveDestinationInfo = useCallback((payload) => {
    const nextStationid = String(payload?.nextStationid || payload?.stationid || '').trim().toUpperCase();
    const nextQrUrl = String(payload?.nextQrUrl || payload?.qrUrl || buildQrUrl(nextStationid));

    setMoveDestinationInfo({
      stationid: nextStationid,
      qrUrl: nextQrUrl,
    });
  }, []);

  const loadMoveNextStation = useCallback(async (selectedCountry) => {
    if (!isAdminUser || !selectedCountry) {
      setMoveDestinationInfo({ stationid: '', qrUrl: '' });
      return;
    }

    if (!firebaseUser) {
      setMoveError('Not signed in');
      setMoveDestinationInfo({ stationid: '', qrUrl: '' });
      return;
    }

    setLoadingMoveNextStation(true);
    setMoveError('');

    try {
      await ensureSignedIn();
      const response = await callFunctionWithAuth('stationBinding_getNextStation', {
        country: selectedCountry,
      });
      syncMoveDestinationInfo(response || {});
    } catch (error) {
      console.error(error);
      setMoveDestinationInfo({ stationid: '', qrUrl: '' });
      setMoveError(error?.message || t('fetch_next_station_failed'));
    } finally {
      setLoadingMoveNextStation(false);
    }
  }, [ensureSignedIn, firebaseUser, isAdminUser, syncMoveDestinationInfo, t]);

  useEffect(() => {
    if (!moveSourceStationId) {
      setMoveModuleId('');
      return;
    }

    const sourceStillExists = (allStationsData || []).some(
      (kiosk) =>
        isNewKioskStation(kiosk?.stationid) &&
        normalizeStationId(kiosk?.stationid) === moveSourceStationId,
    );

    if (!sourceStillExists) {
      setMoveSourceStationId('');
      setMoveModuleId('');
    }
  }, [allStationsData, moveSourceStationId]);

  useEffect(() => {
    if (moveDestinationMode !== 'new') {
      setMoveDestinationInfo({ stationid: '', qrUrl: '' });
      return;
    }

    if (!moveDestinationCountry) {
      setMoveDestinationInfo({ stationid: '', qrUrl: '' });
      return;
    }

    loadMoveNextStation(moveDestinationCountry);
  }, [loadMoveNextStation, moveDestinationCountry, moveDestinationMode]);

  const newKioskStations = (allStationsData || [])
    .filter((kiosk) => isNewKioskStation(kiosk?.stationid))
    .sort((left, right) => normalizeStationId(left?.stationid).localeCompare(normalizeStationId(right?.stationid)));
  const selectedSourceKiosk = newKioskStations.find(
    (kiosk) => normalizeStationId(kiosk?.stationid) === moveSourceStationId,
  ) || null;
  const selectedSourceModules = Array.isArray(selectedSourceKiosk?.modules) ? selectedSourceKiosk.modules : [];
  const selectedSourceModule = selectedSourceModules.find(
    (module) => normalizeModuleId(module?.id) === moveModuleId,
  ) || null;
  const availableDestinationStations = newKioskStations.filter(
    (kiosk) => normalizeStationId(kiosk?.stationid) !== moveSourceStationId,
  );

  useEffect(() => {
    if (!selectedSourceKiosk) {
      setMoveModuleId('');
      return;
    }

    const nextModules = Array.isArray(selectedSourceKiosk.modules) ? selectedSourceKiosk.modules : [];
    const hasSelectedModule = nextModules.some(
      (module) => normalizeModuleId(module?.id) === moveModuleId,
    );

    if (!hasSelectedModule) {
      setMoveModuleId(normalizeModuleId(nextModules[0]?.id || ''));
    }

    if (!moveDestinationCountry) {
      setMoveDestinationCountry(getCountryFromStationId(selectedSourceKiosk.stationid));
    }
  }, [moveDestinationCountry, moveModuleId, selectedSourceKiosk]);

  useEffect(() => {
    if (moveDestinationStationId && moveDestinationStationId === moveSourceStationId) {
      setMoveDestinationStationId('');
    }
  }, [moveDestinationStationId, moveSourceStationId]);

  const focusStationQrInput = useCallback(() => {
    setTimeout(() => {
      stationQrInputRef.current?.focus();
    }, 0);
  }, []);

  const focusModuleInput = useCallback(() => {
    setTimeout(() => {
      moduleIdInputRef.current?.focus();
    }, 0);
  }, []);

  const resetBindingForm = useCallback(() => {
    setStationQrInput('');
    setModuleId('');
    setStationInfo({ stationid: '', qrUrl: '' });
    setPageError('');
    focusStationQrInput();
  }, [focusStationQrInput]);

  const commitStationQrInput = useCallback((rawValue, shouldFocusModule = false) => {
    const parsedValue = parseStationQrInput(rawValue);

    if (!isBindingStationId(parsedValue.stationid)) {
      setStationInfo({ stationid: '', qrUrl: '' });
      setPageError(t('station_qr_invalid'));
      return false;
    }

    syncStationInfo(parsedValue.stationid);
    setPageError('');

    if (shouldFocusModule) {
      focusModuleInput();
    }

    return true;
  }, [focusModuleInput, syncStationInfo, t]);

  useEffect(() => {
    const trimmedStationQrInput = stationQrInput.trim();

    if (!trimmedStationQrInput) {
      setStationInfo({ stationid: '', qrUrl: '' });
      setPageError('');
      return;
    }

    const parsedValue = parseStationQrInput(trimmedStationQrInput);

    if (parsedValue.mode === 'manual') {
      setStationInfo({
        stationid: parsedValue.stationid,
        qrUrl: isBindingStationId(parsedValue.stationid) ? buildQrUrl(parsedValue.stationid) : '',
      });
      setPageError('');
      return;
    }

    const timeoutId = setTimeout(() => {
      if (parsedValue.mode === 'qr') {
        commitStationQrInput(trimmedStationQrInput, true);
        return;
      }

      setStationInfo({ stationid: '', qrUrl: '' });
      setPageError(t('station_qr_invalid'));
    }, 120);

    return () => clearTimeout(timeoutId);
  }, [commitStationQrInput, stationQrInput, t]);

  const handleStationQrInputChange = useCallback((event) => {
    setStationQrInput(event.target.value);
  }, []);

  const handleStationQrInputKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') {
      return;
    }

    if (commitStationQrInput(event.currentTarget.value, true)) {
      event.preventDefault();
    }
  }, [commitStationQrInput]);

  const commitModuleInput = useCallback((rawValue) => {
    const parsedValue = parseModuleScanInput(rawValue);

    if (!parsedValue.moduleId || parsedValue.mode === 'literal' || parsedValue.mode === 'invalid') {
      return false;
    }

    if (normalizeModuleId(rawValue) !== parsedValue.moduleId) {
      setModuleId(parsedValue.moduleId);
    }

    return true;
  }, []);

  useEffect(() => {
    const trimmedModuleId = moduleId.trim();

    if (!trimmedModuleId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      commitModuleInput(trimmedModuleId);
    }, 120);

    return () => clearTimeout(timeoutId);
  }, [commitModuleInput, moduleId]);

  const handleModuleInputChange = useCallback((event) => {
    setModuleId(event.target.value);
  }, []);

  const handleModuleInputKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') {
      return;
    }

    if (commitModuleInput(event.currentTarget.value)) {
      event.preventDefault();
    }
  }, [commitModuleInput]);

  const showBindingError = useCallback((message, target = 'module') => {
    setStatus({ state: 'error', message });

    if (target === 'station') {
      focusStationQrInput();
      return;
    }

    moduleIdInputRef.current?.focus();
  }, [focusStationQrInput]);

  const resolveModuleRequest = useCallback(() => {
    const rawModuleValue = normalizeModuleId(moduleId);

    if (!rawModuleValue) {
      return { error: t('module_id_required') };
    }

    const parsedValue = parseModuleScanInput(rawModuleValue);

    if (parsedValue.mode === 'invalid') {
      return { error: t('module_scan_invalid') };
    }

    const resolvedModuleId = normalizeModuleId(parsedValue.moduleId || rawModuleValue);
    const matchedBinding = findBoundModuleById(allStationsData, resolvedModuleId) ||
      (resolvedModuleId !== rawModuleValue ? findBoundModuleById(allStationsData, rawModuleValue) : null);

    return {
      matchedBinding,
      parsedValue,
      resolvedModuleId,
    };
  }, [allStationsData, moduleId, t]);

  const normalizedStationId = normalizeStationId(stationInfo.stationid);
  const normalizedModuleId = normalizeModuleId(moduleId);
  const bindingCountry = isBindingStationId(normalizedStationId) ?
    getCountryFromStationId(normalizedStationId) :
    '';
  const isFormActive = Boolean(bindingCountry);
  const moveFormReady = Boolean(moveSourceStationId && moveModuleId);

  const handleBind = useCallback(async () => {
    if (!normalizedStationId) {
      setPageError(t('station_qr_required'));
      setStatus({ state: 'error', message: t('station_qr_required') });
      focusStationQrInput();
      return;
    }

    if (!bindingCountry) {
      setPageError(t('station_qr_invalid'));
      setStatus({ state: 'error', message: t('station_qr_invalid') });
      focusStationQrInput();
      return;
    }

    const existingStation = (allStationsData || []).find(
      (kiosk) => normalizeStationId(kiosk?.stationid) === normalizedStationId,
    );

    if (existingStation) {
      setPageError('');
      showBindingError(`${t('binding_station_exists')}: ${normalizedStationId}`, 'station');
      return;
    }

    const moduleResolution = resolveModuleRequest();
    if (moduleResolution.error) {
      setPageError('');
      showBindingError(moduleResolution.error, 'module');
      return;
    }

    if (moduleResolution.matchedBinding) {
      const existingStationId = normalizeStationId(moduleResolution.matchedBinding.kiosk?.stationid);
      setPageError('');
      showBindingError(`${t('binding_module_exists')}: ${existingStationId}`, 'module');
      return;
    }

    if (!moduleResolution.resolvedModuleId) {
      setPageError('');
      showBindingError(t('module_scan_invalid'), 'module');
      return;
    }

    if (moduleResolution.resolvedModuleId !== moduleId) {
      setModuleId(moduleResolution.resolvedModuleId);
    }

    setPageError('');
    setStatus({ state: 'sending', message: `${t('bind_module')}...` });

    try {
      await ensureSignedIn();
      const payload = await callFunctionWithAuth('stationBinding_bindModule', {
        country: bindingCountry,
        stationid: normalizedStationId,
        moduleId: moduleResolution.resolvedModuleId,
      });

      resetBindingForm();
      setStatus({ state: 'success', message: payload?.message || t('command_success') });
    } catch (error) {
      console.error(error);
      setStatus({ state: 'error', message: error?.message || t('command_failed') });
    }
  }, [
    allStationsData,
    bindingCountry,
    ensureSignedIn,
    focusStationQrInput,
    moduleId,
    normalizedStationId,
    resetBindingForm,
    resolveModuleRequest,
    showBindingError,
    t,
  ]);

  const handleUnbind = useCallback(async () => {
    if (!normalizedStationId) {
      setPageError(t('station_qr_required'));
      setStatus({ state: 'error', message: t('station_qr_required') });
      focusStationQrInput();
      return;
    }

    if (!bindingCountry) {
      setPageError(t('station_qr_invalid'));
      setStatus({ state: 'error', message: t('station_qr_invalid') });
      focusStationQrInput();
      return;
    }

    const moduleResolution = resolveModuleRequest();
    if (moduleResolution.error) {
      setPageError('');
      showBindingError(moduleResolution.error, 'module');
      return;
    }

    const requestModuleId = moduleResolution.matchedBinding?.module?.id || moduleResolution.resolvedModuleId;

    if (!requestModuleId) {
      setPageError('');
      showBindingError(t('module_scan_invalid'), 'module');
      return;
    }

    if (requestModuleId !== moduleId) {
      setModuleId(requestModuleId);
    }

    setPageError('');
    setStatus({ state: 'sending', message: `${t('unbind_module')}...` });

    try {
      await ensureSignedIn();
      const payload = await callFunctionWithAuth('stationBinding_unbindModule', {
        country: bindingCountry,
        stationid: normalizedStationId,
        moduleId: requestModuleId,
      });

      resetBindingForm();
      setStatus({ state: 'success', message: payload?.message || t('command_success') });
    } catch (error) {
      console.error(error);
      setStatus({ state: 'error', message: error?.message || t('command_failed') });
    }
  }, [
    bindingCountry,
    ensureSignedIn,
    focusStationQrInput,
    moduleId,
    normalizedStationId,
    resetBindingForm,
    resolveModuleRequest,
    showBindingError,
    t,
  ]);

  const handleMoveModule = useCallback(async () => {
    if (!moveSourceStationId) {
      setStatus({ state: 'error', message: t('select_source_station') });
      return;
    }

    if (!moveModuleId) {
      setStatus({ state: 'error', message: t('select_source_module') });
      return;
    }

    if (moveDestinationMode === 'existing' && !moveDestinationStationId) {
      setStatus({ state: 'error', message: t('select_destination_station') });
      return;
    }

    if (moveDestinationMode === 'new' && !moveDestinationInfo.stationid) {
      setStatus({ state: 'error', message: t('fetch_next_station_failed') });
      return;
    }

    setStatus({ state: 'sending', message: `${t('move_module_button')}...` });
    setMoveError('');

    try {
      await ensureSignedIn();
      const payload = await callFunctionWithAuth('stationBinding_moveModule', {
        sourceStationid: moveSourceStationId,
        moduleId: moveModuleId,
        createNewStation: moveDestinationMode === 'new',
        destinationStationid: moveDestinationMode === 'new' ?
          moveDestinationInfo.stationid :
          moveDestinationStationId,
        destinationCountry: moveDestinationMode === 'new' ? moveDestinationCountry : '',
      });

      setMoveSourceStationId('');
      setMoveModuleId('');
      if (moveDestinationMode === 'new') {
        syncMoveDestinationInfo(payload || {});
        if (!payload?.nextStationid) {
          await loadMoveNextStation(moveDestinationCountry);
        }
      }
      setStatus({ state: 'success', message: payload?.message || t('command_success') });
    } catch (error) {
      console.error(error);
      setMoveError(error?.message || t('command_failed'));
      setStatus({ state: 'error', message: error?.message || t('command_failed') });
      if (moveDestinationMode === 'new' && moveDestinationCountry) {
        await loadMoveNextStation(moveDestinationCountry);
      }
    }
  }, [
    ensureSignedIn,
    loadMoveNextStation,
    moveDestinationCountry,
    moveDestinationInfo.stationid,
    moveDestinationMode,
    moveDestinationStationId,
    moveModuleId,
    moveSourceStationId,
    syncMoveDestinationInfo,
    t,
  ]);

  if (!canManageBindings) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-md">
          <h1 className="text-2xl font-bold text-gray-900">{t('module_binding')}</h1>
          <p className="mt-3 text-sm text-gray-600">{t('no_binding_access')}</p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={onLogout}
              className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <CommandStatusToast status={status} onDismiss={() => setStatus(null)} />

      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <button
            onClick={onNavigateToDashboard}
            className="rounded-md bg-gray-200 p-2 text-gray-700 hover:bg-gray-300"
            title={t('back_to_dashboard')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="rounded-lg bg-white shadow-md">
              <div className="border-b border-gray-200 px-6 py-6">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">{t('module_binding')}</p>
              </div>

              <div className="space-y-8 px-6 py-6">
                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
                  {t('station_qr_hint')}
                </div>

                <div className="grid gap-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-gray-700">{t('station_qr_scan')}</span>
                    <input
                      ref={stationQrInputRef}
                      type="text"
                      value={stationQrInput}
                      onChange={handleStationQrInputChange}
                      onKeyDown={handleStationQrInputKeyDown}
                      placeholder="https://chargerent.online/stations/qr?id=US8001"
                      className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    />
                  </label>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">{t('station_id')}</p>
                    <p className="mt-1 text-2xl font-bold tracking-[0.08em] text-gray-900">
                      {normalizedStationId || '--'}
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-gray-700">{t('manufacturer_module_id')}</span>
                    <input
                      ref={moduleIdInputRef}
                      type="text"
                      value={moduleId}
                      onChange={handleModuleInputChange}
                      onKeyDown={handleModuleInputKeyDown}
                      placeholder="867652077228617"
                      disabled={!isFormActive}
                      className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleBind}
                    disabled={!isFormActive || !normalizedModuleId || !stationInfo.stationid}
                    className="inline-flex flex-1 items-center justify-center rounded-md bg-green-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
                  >
                    {t('bind_module')}
                  </button>
                  <button
                    type="button"
                    onClick={handleUnbind}
                    disabled={!isFormActive || !normalizedModuleId || !normalizedStationId}
                    className="inline-flex flex-1 items-center justify-center rounded-md bg-red-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-red-300"
                  >
                    {t('unbind_module')}
                  </button>
                </div>

                {pageError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {pageError}
                  </div>
                )}
              </div>
            </div>

            {isAdminUser && (
              <div className="rounded-lg bg-white shadow-md">
                <div className="border-b border-gray-200 px-6 py-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">{t('move_module_title')}</p>
                  <h3 className="mt-2 text-2xl font-bold text-gray-900">{t('move_module_heading')}</h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">{t('move_module_subtitle')}</p>
                </div>

                <div className="space-y-6 px-6 py-6">
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-gray-700">{t('source_station')}</span>
                      <select
                        value={moveSourceStationId}
                        onChange={(event) => setMoveSourceStationId(normalizeStationId(event.target.value))}
                        className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      >
                        <option value="">{t('select_source_station')}</option>
                        {newKioskStations.map((kiosk) => (
                          <option key={kiosk.stationid} value={kiosk.stationid}>
                            {kiosk.stationid} ({Array.isArray(kiosk.modules) ? kiosk.modules.length : 0} modules)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-gray-700">{t('source_module')}</span>
                      <select
                        value={moveModuleId}
                        onChange={(event) => setMoveModuleId(normalizeModuleId(event.target.value))}
                        disabled={!moveSourceStationId}
                        className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        <option value="">{t('select_source_module')}</option>
                        {selectedSourceModules.map((module) => (
                          <option key={module.id} value={module.id}>
                            {module.id} ({Array.isArray(module.slots) ? module.slots.length : 0} slots)
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">{t('destination_mode')}</p>
                    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1">
                      <button
                        type="button"
                        onClick={() => setMoveDestinationMode('existing')}
                        className={`rounded-md px-5 py-2 text-sm font-bold transition ${
                          moveDestinationMode === 'existing'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-white hover:text-gray-900'
                        }`}
                      >
                        {t('move_to_existing')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMoveDestinationMode('new')}
                        className={`rounded-md px-5 py-2 text-sm font-bold transition ${
                          moveDestinationMode === 'new'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-white hover:text-gray-900'
                        }`}
                      >
                        {t('move_to_new_station')}
                      </button>
                    </div>
                  </div>

                  {moveDestinationMode === 'existing' ? (
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-gray-700">{t('destination_station')}</span>
                      <select
                        value={moveDestinationStationId}
                        onChange={(event) => setMoveDestinationStationId(normalizeStationId(event.target.value))}
                        disabled={!moveFormReady}
                        className="w-full rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        <option value="">{t('select_destination_station')}</option>
                        {availableDestinationStations.map((kiosk) => (
                          <option key={kiosk.stationid} value={kiosk.stationid}>
                            {kiosk.stationid} ({Array.isArray(kiosk.modules) ? kiosk.modules.length : 0} modules)
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="grid gap-5">
                      <div>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">{t('destination_country')}</p>
                        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1">
                          {COUNTRY_OPTIONS.map((option) => {
                            const active = moveDestinationCountry === option.code;
                            return (
                              <button
                                key={option.code}
                                type="button"
                                onClick={() => setMoveDestinationCountry(option.code)}
                                disabled={!moveFormReady}
                                className={`rounded-md px-5 py-2 text-sm font-bold transition ${
                                  active
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-white hover:text-gray-900'
                                } disabled:cursor-not-allowed disabled:text-gray-400`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-gray-700">{t('next_station_qr')}</span>
                        <input
                          type="text"
                          readOnly
                          value={moveDestinationCountry ? (loadingMoveNextStation ? t('loading') : moveDestinationInfo.qrUrl) : ''}
                          placeholder={t('select_country_first')}
                          disabled={!moveDestinationCountry || !moveFormReady}
                          className="w-full rounded-md border border-gray-300 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-700 outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </label>

                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">{t('destination_station')}</p>
                        <p className="mt-1 text-2xl font-bold tracking-[0.08em] text-gray-900">
                          {!moveDestinationCountry ? '--' : (loadingMoveNextStation ? '...' : (moveDestinationInfo.stationid || '--'))}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {selectedSourceModule ? t('move_last_module_hint') : t('move_module_hint')}
                  </div>

                  <button
                    type="button"
                    onClick={handleMoveModule}
                    disabled={
                      !moveFormReady ||
                      (moveDestinationMode === 'existing' && !moveDestinationStationId) ||
                      (moveDestinationMode === 'new' && (!moveDestinationCountry || !moveDestinationInfo.stationid || loadingMoveNextStation))
                    }
                    className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {t('move_module_button')}
                  </button>

                  {moveError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {moveError}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow-md">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">{t('module_binding')}</p>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-gray-500">{t('binding_country')}</dt>
                  <dd className="mt-1 font-semibold text-gray-900">{bindingCountry || '--'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('station_id')}</dt>
                  <dd className="mt-1 font-semibold text-gray-900">{normalizedStationId || '--'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('station_qr_scan')}</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-gray-700">
                    {stationInfo.qrUrl || '--'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{t('manufacturer_module_id')}</dt>
                  <dd className="mt-1 font-semibold text-gray-900">{normalizedModuleId || '--'}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
