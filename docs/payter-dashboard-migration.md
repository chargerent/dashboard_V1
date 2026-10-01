# Payter dashboard migration

## What the current live UI does

The public Payter page is a Node-RED Dashboard application. It does not stream video from a physical terminal.

1. Payter HTTP callbacks and MQTT messages reach the Canada Node-RED runtime.
2. Node-RED updates its `apollos` terminal-state array in Node-RED context.
3. Node-RED Dashboard sends terminal-state payloads to the browser over its Socket.IO connection.
4. Angular `ui_template` nodes turn each state into HTML for the terminal replica.
5. Live-mode, reboot, rental, return, and language actions travel back over Socket.IO and are handled by Node-RED.

The mirror is therefore a synthetic, live rendering of structured terminal state. It is not an iframe, screenshot feed, or remote-control video stream.

## Dashboard implementation

`PayterPage.jsx` preserves that model but renders trusted React components from structured data. It never inserts server-generated HTML. The React port reproduces the live Node-RED editor, the 450 x 600 preview terminal, the 225 x 300 admin terminal cards, all 13 editable UI states, and the current EN/FR/ES translation fields.

The page listens for these Firestore records:

- `payterTerminals/{terminalId}`: the current state of each terminal.
- `payterRuntime/current`: bridge-readiness and feature flags.
- `payterUiConfig/current`: versioned UI translation data.

All three collections are administrator-readable only. Client writes are denied. Commands and translation changes use the dashboard's existing Firebase ID token and authenticated Cloud Function request path.

### Terminal-state contract

The state bridge should send these fields:

```json
{
  "terminalId": "stable internal ID",
  "serialNumber": "terminal serial",
  "terminalName": "display name",
  "state": "terminal/backend state",
  "online": true,
  "live": true,
  "defaultLanguage": "en",
  "currentLanguage": "en",
  "uistate": "paymentpage",
  "dynamicData": {
    "slot": "4",
    "module": "M04"
  },
  "translations": {},
  "errorMessage": "",
  "bridgeUpdatedAt": "Firestore timestamp"
}
```

The normalizer also accepts short aliases and legacy casing such as `payment`, `PaymentPage`, `ThankYouPage`, and `OfflineModePage`, but stores the live full state names such as `paymentpage`.

## Safe bridge and cutover

The existing callback paths must remain exact and unauthenticated for the Payter vendor:

- `POST /api/ui`
- `POST /api/apollo_states`

Firebase authentication belongs on the dashboard and its new management APIs, not on those vendor callback paths.

Recommended cutover sequence:

1. Back up the Canada Node-RED flow and credentials files separately.
2. Add a non-blocking branch after the existing state update that sends normalized state to an HMAC-authenticated ingestion function.
3. Write state to `payterTerminals` and verify that the dashboard matches the old Node-RED screen for every UI state and language.
4. Keep `commandsEnabled` and `editorEnabled` false while state parity is tested.
5. Add an authenticated command adapter with request IDs, deduplication, audit records, timeouts, and Node-RED acknowledgements.
6. Enable commands for one test terminal, then expand only after rental, return, live-mode, and reboot tests pass.
7. Add the versioned translation adapter and enable editor saving last.
8. After a parallel-observation period, remove public browser access to `/api/ui/` while preserving the two exact callback routes above.

The Node-RED callback response path must not wait for Firestore or the dashboard bridge. A bridge outage should make the dashboard state stale, never delay or fail a Payter callback.

## Feature flags

`payterRuntime/current` defaults safely when it is absent:

```json
{
  "stateBridgeReady": false,
  "commandsEnabled": false,
  "editorEnabled": false
}
```

The local-only preview is available during development at `/portal/?page=payter-preview`. It uses synthetic data, does not authenticate, does not read production terminal records, and keeps all control and save actions disabled.

## Unified client profiles (local implementation, September 7, 2026)

The existing Client profiles page owns kiosk-screen, Apollo, and P68 content. The Payter operations page links to it; the old global Apollo editor is retained only in the development preview. Hardware determines the available sections and eligible targets. Apollo is available only when `hardware.gateway` is exactly `APOLLO`. P68 is available only when `hardware.gateway` is exactly `PAYTERP68` and `screen.mode` is not `UI`. Kiosk access is available only when `ui.mode` is `UI` and targets only those kiosks. A missing field is unknown, and `no screen` does not hide a payment terminal.

- Kiosk-screen content remains in `ui` and `languages`, retaining existing profile IDs.
- P68 default messages remain in `languages.locales.{en,fr,es}.terminals.PAYTERP68`. The five existing fields are start, wait, takeCharger, returned, and soldOut. They are distinct from the kiosk payment-instruction screen.
- Apollo default copy is stored in `terminalProfiles.apollo.translations`.
- Every kiosk assigned to a client uses the same client-wide terminal profile for its gateway. Apollo and P68 do not support per-kiosk content overrides; selecting kiosks changes only the publish targets.
- `sectionVersions` records saved revisions. This is not immutable version history or runtime rollback support.

`uiProfile_list` advertises `capabilities.scopedProfiles: 1`. Until that contract is deployed, the new page permits local editing/preview but disables server save and publish. Simply opening the page no longer creates profiles in Firestore; missing clients get an unsaved template.

Scoped saves use the existing callable/HTTP upsert with `section`. Only the requested client-wide section changes. The server rejects station-specific terminal content, verifies client ownership, administrator access for Apollo, and the reviewed profile version. Scoped apply requires `section`, `profileId`, `expectedVersion`, and explicit `stationids`; it checks every target before an atomic update. P68 applies preserve the target's touchscreen, UI mode/version/created fields, access PINs, hardware, and legacy language representation. Kiosk-screen applies preserve P68 text. PINs change only through Kiosk access.

Publishing uses the existing kiosk `uichange` path for kiosk-screen/P68/access sections. A successful database write or command send is not device adoption. `ui.profileSections.{section}` stores the requested version; confirmation requires matching `reportedUiProfile.sections.{section}` telemetry. Existing runtimes do not yet necessarily report this telemetry. Profile command feedback stays on the profile page; connection failures must not be reported as a successful send.

Apollo publishing is rejected by the server regardless of UI flags. The editor lists the active established screens in a visible, numbered inventory, places intentionally removed screens in a restorable list, and keeps added message/selection screens in a separate section. Its `yyz-apollo-v1` default was copied from the shared Canada Node-RED flow used by YYZ and verified against persisted `global.languages` on September 7, 2026; it is not a direct read-back from each Payter terminal. The Canada profile resolver, live profile import, immutable runtime versions, per-session version pinning, acknowledgements, and pilot rollout remain transition work. MyPayter asset/firmware management is unchanged.

Before enabling production publishing, deploy the scoped list/upsert/apply functions and their HTTP equivalents as a coordinated release. Verify a test kiosk's actual P68 message adoption and `uichange` behavior during a transaction before expanding rollout. This page refactor does not establish interruption-free runtime activation and does not require a Node-RED restart.

Development verification: `/portal/?page=profiles-preview` uses sample Apollo-only, P68-only, and mixed clients. Its saves use an in-memory document store and publishing is always disabled. It must remain gated by `import.meta.env.DEV`. Tests cover section isolation, client-wide P68 copy, legacy-override cleanup, server permissions, stale versions, atomic target validation, and adoption reporting.

## Added Apollo screens (local implementation)

Client profiles → Apollo now supports adding, naming, duplicating and deleting message or selection screens. Each screen has English/French/Spanish content, with field-level English fallback. Buttons link to another added screen, continue the existing rent/return flow, or return to Start. The first screen is selected under **After Start, show**; an empty selection keeps the existing flow. Unlinked screens remain drafts. The preview starts at Start, follows the same navigation resolver as the payload helpers, and stops at the existing rent/return flow. It performs no network or payment actions.

`terminalProfiles.apollo.screenFlow` stores `{version: 1, entryScreenId, screens, removedEstablishedScreenIds}` alongside existing `translations`. A custom screen stores `{id, name, type, locales, buttons}`; buttons store stable `{id, labels, next}`. IDs use the `custom_` and `button_` namespaces. `$continue` and `$home` are navigation intents, not Payter commands. The single saved Apollo flow applies to every Apollo kiosk assigned to that client. Text-only saves from older editors preserve an existing screen flow; deleting all added screens saves an explicit empty flow. Older saved version-1 flows without `removedEstablishedScreenIds` remain valid and are treated as having no removed established screens.

Established screens may be removed from a client flow and restored later without losing their translations. Removal means “skip this presentation state,” not “delete the underlying business event.” The backend accepts only known, explicitly removable screen IDs and resolves safe fallback chains. Start, Rent or return, Availability, Payment, Dispensing, and Return instructions are required. Availability must remain visible until the inventory result is known, and Dispensing must remain visible until the physical vend result is known. Draft storage and validation are implemented; the Canada runtime bridge still needs to consume this resolver before a physical terminal will skip an optional screen.

The shared `functions/apolloScreens.mjs` validates the schema, generates CPS UI requests, and resolves button destinations. Frontend and server reject missing targets, invalid layouts, empty required English text, duplicate identifiers, and navigation loops with no exit. Deleting a screen with incoming button links requires changing those links first. Deleting the first screen restores the existing entry flow. The editor permits 24 added screens, 3 buttons per screen, 120-character titles, 600-character messages, and 60-character button labels; these are application limits, not verified hardware limits.

The UI payload builder follows the production CPS specification inspected September 7, 2026 at `https://cps.mypayter.com/v3/api-docs`: `POST /terminals/{serialNumber}/ui` takes `{id, type, properties}`. Message screens use title/message and `buttons.<id>.label`; selection screens use title and `items.<id>.label`. No arbitrary HTML, image upload, payment amounts, callback URLs or firmware changes can be authored through this screen model. Physical rendering and firmware/layout compatibility still need a pilot check.

`uiProfile_list` also advertises `capabilities.apolloScreens: 1` and `capabilities.apolloEstablishedScreenRemoval: 1`. The frontend requires these versioned contracts before saving the corresponding screen-flow content, avoiding loss or rejection against an older service. Apollo apply remains rejected server-side. Deploying the profile functions alone enables draft storage, not terminal activation.

### Guarded terminal screen test

The local backend now has a deliberately narrow test adapter for added Apollo screens. It is not Apollo publishing and it is not the production customer flow. An administrator chooses one saved client profile and one explicitly allowlisted Apollo kiosk. The backend resolves the kiosk's terminal serial, verifies `hardware.gateway` is exactly `APOLLO`, verifies the kiosk belongs to the profile client, pins the saved profile version and sends only the selected added-screen sequence through Payter CPS. `$continue` and `$home` complete the test record; neither starts payment, return, dispensing or a Node-RED action.

The profile page exposes the test control only when `uiProfile_list` reports `capabilities.apolloTestScreens: 1`. Runtime access remains locked unless `payterRuntime/current` contains:

```json
{
  "apolloProfileTestsEnabled": true,
  "apolloTestStationIds": ["EXPLICIT-TEST-KIOSK"],
  "apolloCpsEnvironment": "test"
}
```

`apolloCpsEnvironment` accepts `test`, `production`, or `dev`; use the environment in which the allowlisted serial is registered. Deployment also requires the Firebase Functions secret `PAYTER_CPS_API_KEY`. The secret is never returned to the browser. The public CPS callback uses an expiring high-entropy correlation token, and `apolloProfileTests` plus `apolloProfileTestLocks` are denied to Firestore clients. A per-terminal lock rejects overlapping tests. Test records expire logically after 15 minutes, reject mismatched serial/request IDs and deduplicate repeat callbacks.

Recommended first-client sequence:

1. A newly provisioned kiosk with a terminal serial, client, station ID, non-pending status and `hardware.gateway: APOLLO` automatically seeds `yyz-apollo-v1` into that client's saved profile. Existing profiles receive only the missing Apollo section; other kiosk, P68 and access sections are preserved.
2. For an older client that predates the provisioning trigger, open Client profiles → Apollo, click **Load YYZ default**, review it and save the draft.
3. Review the established screen text, remove any optional presentation screens that the client does not need, create any added message/selection screens, and choose the first screen under **After Start, show**. Removed screens remain restorable and required customer-action screens cannot be removed.
4. Save the Apollo draft. This updates the single client-wide profile; it does not touch any terminal.
5. Enable exactly one non-customer test kiosk in `apolloTestStationIds`, keep every other kiosk excluded, then use **Send saved test**.
6. Confirm the physical terminal rendering and button callbacks. A successful CPS request or dashboard `waiting` state is not physical-screen proof.
7. Disable the test flag after the pilot.

This adapter can validate only the added message/selection sequence. Testing edits or removals in the established runtime screens, inserting the client profile at the actual customer Start boundary, freezing a profile for a complete rent/return session, and handing `$continue` into the existing payment/vend runtime still require the Canada Node-RED profile resolver and bridge work described below. Normal Apollo publish remains rejected.

Before connecting these drafts to terminals, the Canada adapter must resolve the terminal serial to its kiosk and client, then freeze that client's Apollo profile version when a customer starts. It should enter `entryScreenId` at the start boundary before the current rent/return flow, call `buildApolloScreenRequest`, correlate and deduplicate callback serial/screen IDs to the active session, then call `resolveApolloScreenAction`. For each established presentation state it must call `resolveApolloEstablishedScreen` before sending UI, while still running the original payment, inventory, dispense, or return event. The custom-screen resolver emits `show_screen`, `continue_existing_flow`, or `return_to_start`; only the existing payment runtime may initiate payment or dispense operations. The adapter must reject stale/unexpected callbacks and never replace an active payment screen. Transport, activation, runtime acknowledgements and physical pilot verification are still pending.

Verification includes `scripts/apollo-screens.test.mjs`, actual scoped-handler tests, regression checks for P68/profile isolation, local browser creation/navigation/language/client-wide-flow checks, lint and a production build. No live terminals are changed by these checks.
