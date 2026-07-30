"use strict";

function preserveProvisionedUiMode(profileSnapshot, kioskUi) {
  const nextUi = {...(profileSnapshot || {})};
  delete nextUi.mode;

  if (kioskUi && Object.prototype.hasOwnProperty.call(kioskUi, "mode")) {
    nextUi.mode = kioskUi.mode;
  }

  return nextUi;
}

module.exports = {
  preserveProvisionedUiMode,
};
