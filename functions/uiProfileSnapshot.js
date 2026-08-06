"use strict";

const KIOSK_OWNED_UI_FIELDS = ["mode", "version", "created"];

function preserveProvisionedUiMode(profileSnapshot, kioskUi) {
  const nextUi = {...(profileSnapshot || {})};

  KIOSK_OWNED_UI_FIELDS.forEach((field) => {
    delete nextUi[field];

    if (kioskUi && Object.prototype.hasOwnProperty.call(kioskUi, field)) {
      nextUi[field] = kioskUi[field];
    }
  });

  return nextUi;
}

module.exports = {
  preserveProvisionedUiMode,
};
