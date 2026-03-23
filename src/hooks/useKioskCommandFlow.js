import { useCallback, useState } from 'react';
import { isNewSchemaKiosk } from '../utils/helpers';

export default function useKioskCommandFlow({
  allStationsData,
  setEjectingSlots,
  manageIgnoredKiosk,
  onCommand,
  t,
}) {
  const [commandDetails, setCommandDetails] = useState(null);
  const [commandModalOpen, setCommandModalOpen] = useState(false);

  const handleSlotClick = useCallback((stationid, moduleid, slotid) => {
    const confirmationText = `${t('eject_confirmation')} ${slotid}?`;
    const targetKiosk = allStationsData.find((kiosk) => kiosk.stationid === stationid);
    const targetModule = targetKiosk?.modules?.find((module) => module.id === moduleid);
    const targetSlot = targetModule?.slots?.find((slot) => slot.position === slotid);
    const chargerid = Number(targetSlot?.sn || 0);
    const action = isNewSchemaKiosk(targetKiosk) && chargerid ? 'vend' : 'eject specific';

    setCommandDetails({
      stationid,
      moduleid,
      slotid,
      action,
      chargerid: action === 'vend' ? chargerid : undefined,
      confirmationText,
    });
    setCommandModalOpen(true);
  }, [allStationsData, t]);

  const handleLockSlotClick = useCallback((stationid, moduleid, slotid, isCurrentlyLocked) => {
    const action = isCurrentlyLocked ? 'unlock slot' : 'lock slot';
    const confirmationText = `${isCurrentlyLocked ? t('unlock_confirmation') : t('lock_confirmation')} ${slotid}?`;
    const targetKiosk = allStationsData.find((kiosk) => kiosk.stationid === stationid);

    let lockReason = '';
    if (isCurrentlyLocked) {
      const targetModule = targetKiosk?.modules.find((module) => module.id === moduleid);
      const targetSlot = targetModule?.slots.find((slot) => slot.position === slotid);
      if (targetSlot?.lockReason) {
        lockReason = targetSlot.lockReason;
      }
    }

    setCommandDetails({ stationid, moduleid, slotid, action, confirmationText, lockReason });
    setCommandModalOpen(true);
  }, [allStationsData, t]);

  const handleSendCommand = useCallback((confirmationResult = null) => {
    setCommandModalOpen(false);

    if (!commandDetails) {
      return;
    }

    const { stationid, moduleid, slotid, action } = commandDetails;

    if (action.includes('change')) {
      manageIgnoredKiosk(stationid, false);
    }

    if (action.startsWith('eject') || action === 'rent' || action === 'vend') {
      const targetKiosk = allStationsData.find((kiosk) => kiosk.stationid === stationid);
      if (!targetKiosk) {
        return;
      }

      const slotsToEject = [];
      const powerThreshold = targetKiosk.hardware?.power || 80;

      switch (action) {
        case 'eject specific':
        case 'rent':
        case 'vend':
          slotsToEject.push({ stationid, moduleid, slotid });
          break;
        case 'eject module': {
          const targetModule = targetKiosk.modules.find((module) => module.id === moduleid);
          if (targetModule) {
            targetModule.slots.forEach((slot) => {
              if (slot.sn && slot.sn !== 0) {
                slotsToEject.push({ stationid, moduleid: targetModule.id, slotid: slot.position });
              }
            });
          }
          break;
        }
        case 'eject all':
          targetKiosk.modules.forEach((module) => {
            module.slots.forEach((slot) => {
              if (slot.sn && slot.sn !== 0 && !slot.isLocked) {
                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
              }
            });
          });
          break;
        case 'eject full':
          targetKiosk.modules.forEach((module) => {
            module.slots.forEach((slot) => {
              if (slot.sn && slot.sn !== 0 && slot.batteryLevel >= powerThreshold) {
                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
              }
            });
          });
          break;
        case 'eject empty':
          targetKiosk.modules.forEach((module) => {
            module.slots.forEach((slot) => {
              if (slot.sn && slot.sn !== 0 && typeof slot.batteryLevel === 'number' && slot.batteryLevel < powerThreshold && !slot.isLocked) {
                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
              }
            });
          });
          break;
        case 'eject locked':
          targetKiosk.modules.forEach((module) => {
            module.slots.forEach((slot) => {
              if (slot.isLocked) {
                slotsToEject.push({ stationid, moduleid: module.id, slotid: slot.position });
              }
            });
          });
          break;
        default:
          break;
      }

      if (slotsToEject.length > 0) {
        setEjectingSlots((prev) => [...prev, ...slotsToEject]);
      }
    }

    const confirmationPayload = confirmationResult && typeof confirmationResult === 'object'
      ? confirmationResult
      : null;
    const lockReason = typeof confirmationResult === 'string' ? confirmationResult : null;
    const shouldChangeStatusToProvisioned = confirmationPayload?.changeStatusToProvisioned === true;
    const extraConfirmationDetails = confirmationPayload ? { ...confirmationPayload } : {};
    delete extraConfirmationDetails.changeStatusToProvisioned;
    const kioskPayload = commandDetails.action.includes('change') && shouldChangeStatusToProvisioned
      ? { ...commandDetails.kiosk, status: 'provisioned' }
      : commandDetails.kiosk;

    const details = {
      ...(commandDetails.action.includes('change') && { kiosk: kioskPayload, autoGeocode: commandDetails.autoGeocode }),
      ...((commandDetails.action === 'lock slot' || commandDetails.action === 'unlock slot' || commandDetails.action === 'eject specific' || commandDetails.action === 'rent' || commandDetails.action === 'vend') && { slotid: commandDetails.slotid, info: lockReason }),
      ...(commandDetails.action === 'vend' && { chargerid: commandDetails.chargerid }),
      ...(commandDetails.action === 'eject count' && { slotid: commandDetails.slotid }),
      ...extraConfirmationDetails,
    };

    onCommand(commandDetails.stationid, commandDetails.action, commandDetails.moduleid, commandDetails.provisionid, commandDetails.uiVersion, details);
  }, [allStationsData, commandDetails, manageIgnoredKiosk, onCommand, setEjectingSlots]);

  const handleKioskSave = useCallback((stationid, section, data, autoGeocode) => {
    const targetKiosk = allStationsData.find((kiosk) => kiosk.stationid === stationid);
    const normalizedStatus = String(targetKiosk?.status || '').trim().toLowerCase();
    const showProvisionStatusCheckbox = isNewSchemaKiosk(targetKiosk) && (
      normalizedStatus === 'pending' || normalizedStatus === 'provisioned'
    );
    let action;
    if (section === 'pricing') {
      action = 'pricechange';
    } else if (section === 'hardware') {
      action = 'hardwarechange';
    } else if (section === 'ui') {
      action = 'uichange';
    } else {
      action = 'infochange';
    }

    setCommandDetails({
      stationid,
      action,
      kiosk: data,
      autoGeocode,
      confirmationText: t('save_info_confirmation'),
      checkbox: showProvisionStatusCheckbox ? {
        name: 'changeStatusToProvisioned',
        label: t('change_status_to_provisioned'),
        checked: normalizedStatus === 'provisioned',
        disabled: normalizedStatus === 'provisioned',
        helperText: normalizedStatus === 'provisioned' ? t('station_already_provisioned') : '',
      } : null,
    });
    setCommandModalOpen(true);
  }, [allStationsData, t]);

  const handleGeneralCommand = useCallback((stationid, action, moduleid = null, provisionid = null, uiVersion = null, details = null) => {
    let confirmationText = `Are you sure you want to ${action}?`;
    const targetKiosk = allStationsData.find((kiosk) => kiosk.stationid === stationid);
    const commandDetailsPayload = { stationid, action, moduleid, provisionid, uiVersion, ...details };

    if (action === 'disable' && targetKiosk?.disabled) {
      action = 'enable';
    }

    if (action === 'reboot') {
      confirmationText = t('reboot_confirmation');
    } else if (action === 'ngrok connect') {
      confirmationText = t('ngrok_connect_confirmation');
    } else if (action === 'ngrok disconnect') {
      confirmationText = t('ngrok_disconnect_confirmation');
    } else if (action === 'ssh connect') {
      confirmationText = t('ssh_connect_confirmation');
    } else if (action === 'ssh disconnect') {
      confirmationText = t('ssh_disconnect_confirmation');
    } else if (action === 'enable') {
      confirmationText = t('enable_confirmation');
    } else if (action === 'disable') {
      confirmationText = t('disable_confirmation');
    } else if (action === 'eject module') {
      confirmationText = `${t('eject_module_confirmation')}?`;
      commandDetailsPayload.slotid = moduleid;
    } else if (action === 'update module') {
      confirmationText = `${t('update_module_confirmation')} ${moduleid}?`;
    } else if (action === 'lock module') {
      confirmationText = `${t('lock_module_confirmation')}?`;
      commandDetailsPayload.slotid = moduleid;
    } else if (action === 'refund') {
      onCommand(stationid, 'refund', null, null, null, details);
      return;
    } else if (action === 'rent') {
      confirmationText = t('rent_confirmation');
    } else if (action === 'eject count') {
      confirmationText = `${t('eject_count_confirmation')} ${details.slotid} ${t('chargers')}?`;
    }

    commandDetailsPayload.action = action;
    commandDetailsPayload.confirmationText = confirmationText;
    setCommandDetails(commandDetailsPayload);
    setCommandModalOpen(true);
  }, [allStationsData, onCommand, t]);

  return {
    commandDetails,
    commandModalOpen,
    setCommandModalOpen,
    handleGeneralCommand,
    handleKioskSave,
    handleLockSlotClick,
    handleSendCommand,
    handleSlotClick,
  };
}
