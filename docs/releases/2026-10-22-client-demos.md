# Client demos — dashboard v1.113

Adds an administrator-only Demos workspace for branded CK40 station screens.
The first published profile is Children’s Health. Each profile has a stable
`https://demo.chargerentstations.com/<slug>` URL, draft/publish controls, a saved-draft
preview, duplication, disabling, language artwork, accent and a daily SMS cap.
Verification uses real Twilio Verify; the slot-03 eject is simulated. The demo
has no physical station connection, card payment or production rental writes.

The public demo Worker and D1/R2 data are published through the existing Sites
project `appgprj_6ad9b9c2256c819185f1d84a27e42199`. The management API validates the
portal's Firebase ID token and signed administrator claims; no management secret
is exposed to the browser. Published client configuration excludes its internal
client ID. SMS challenges and quotas are separated by demo.

## Portal release scope

The live portal index has import-map repairs for profiles, App rental references
and rental dispense information. Preserve that index and all existing assets.
Deploy only `dist-demos/demos/` and `dist-demos/demo-assets/`, then add the generated
`demos-nav-*.js` module to the existing index. This module adds a Demos link for
signed-in administrators without replacing the running application graph.
The standalone workspace reuses Firebase's existing persisted dashboard session.
The source also integrates Demos into App/Admin/Dashboard for the next full build.

Build: `node node_modules/vite/bin/vite.js build --config vite.demos.config.js`.
The ordinary dashboard build also passes. No Cloud Functions, Firestore rules,
Node-RED flow, kiosk APK or station configuration is released by this change.

Back up the existing index and version marker; retain existing installer archives.
The backend storage retention dry-run reported 13.88 GiB free before release.
Rollback: restore those two files; the added assets can remain harmlessly served.
The public profile can also be disabled from Demos.

## Validation

Worker tests cover real-provider approval gating, consent/CSRF, retries/expiry,
profile/browser isolation, per-profile/global text limits, draft/publish/disable,
revision conflicts, config validation, CORS and Firebase token signature/claims.
The local isolated fake provider verifies the full screen-to-simulated-eject flow.
Real recipient delivery remains a user-entered phone test; no personal number is
hardcoded or used automatically in verification.
