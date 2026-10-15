# Receipt page editor

Open a client in UI edit, choose Chargerent app, then Receipt page. This edits the web page opened by the transaction receipt QR. Its English, French and Spanish text fields cover headings, rental/payment labels, status explanations, buttons and loading/error messages. The preview uses example transactions and cannot read real receipts or change payments.

Administrators can select a PNG, JPEG or WebP client logo (up to 2 MiB, maximum 4096 pixels per side). Selection previews locally. Save draft uploads through the existing `admin_uploadReceiptLogo` endpoint and saves the returned logo metadata with this client's app profile; failed profile saves reuse the uploaded asset on retry. Publish activates the receipt text and logo. Removing the logo is also a draft change until publication. Without a configured profile logo, receipts retain the existing account receipt-logo fallback.

The settings live at `applicationProfiles.chargerentMedia.receiptPage`; public receipts read only `publishedSections.chargerentApp.value.receiptPage`. Receipt lookup follows the rental's client identity, including after a station changes clients. Ambiguous profiles or invalid presentation settings fall back to the default receipt rather than hiding transaction data. Rental values and payment settlement remain authoritative server data.

`functions/receiptPageProfile.mjs` defines the validated text/logo contract. `functions/receiptPage.mjs` renders the public page and dashboard preview. Keep their copies in the media app's `lab` directory identical, along with the existing `rentalReceipt.js` / `receipt-core.cjs` pair. The host's `lab/receipt-page.mjs` exports the renderer. These settings do not enter the native Stripe UI schema.

Release requires the dashboard, updated profile validation, `rentalReceiptApi`, and media-host receipt renderer/modules. No APK update is required. Local changes do not activate through a profile publish until those services have been deployed.

The profile list advertises `capabilities.receiptPages: 1` only with the updated validation service. When connected to an older service, the editor omits untouched receipt defaults from ordinary checkout saves. Actual receipt edits, pending logo uploads, and previously saved receipt settings are retained and require the updated service; they are never silently removed to force a save.

Validation covers receipt/profile publication, tenant isolation, signed receipt reads, logo validation, HTML/script escaping, payment refresh behavior and desktop/mobile editing in `functions/receiptPage.test.mjs`, `functions/rentalReceipt.test.js`, `scripts/ui-profile-scoped-handlers.test.mjs`, and `tests/e2e/receipt-page-editor.spec.js`.
