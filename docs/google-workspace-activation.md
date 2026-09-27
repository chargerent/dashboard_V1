# Partner email activation progress

The user authorized activating partner email creation on September 8, 2026. Activation is complete: the protected rules, 15 scoped Functions, and partner-email frontend are deployed and verified. No Google mailbox or email message was created/sent during activation, and no commit or push was performed.

## Verified cloud changes

- Enabled `admin.googleapis.com`; `iamcredentials.googleapis.com` was already enabled.
- Created `workspace-partner-provisioner@node-red-alerts.iam.gserviceaccount.com`.
- OAuth client ID: `114192998402115898583`.
- Created custom role `projects/node-red-alerts/roles/workspaceMailboxJwtSigner`, containing only `iam.serviceAccounts.signJwt`.
- Granted that role on the dedicated provisioning service account, only to the current Functions runtime `176963151151-compute@developer.gserviceaccount.com`.
- No service-account private key was created or downloaded.
- Verified trusted dashboard administrator `chargerent`, UID `yfVaQAuxjhWPzXQhnNYGkxA4qPB3`.
- Verified existing `GMAIL_APP_PASSWORD` secret version 1 is enabled; its value was not read or changed.

## Google Admin authorization verified

Google Admin must authorize client ID `114192998402115898583` for exactly:

```text
https://www.googleapis.com/auth/admin.directory.user
```

An administrator must be signed in to the `charge.rent` Google Admin console. Confirm the actual administrator email used for delegation, the intended organizational unit, Gmail availability, and licensing before enabling the backend flag. Configure only the Directory scope; no mailbox-content access is required.

The user explicitly requested Chrome and completed sign-in. The dedicated Admin tab verified `george@charge.rent`, organization Ocharge LLC, and primary domain `charge.rent`.

Automatic approval review initially rejected the final Authorize click, and the user was asked to approve the exact client/resource/scope. The user then completed the Google Admin action and replied “done.” The dedicated Chrome tab now shows a saved delegation row for `workspace-partner-provisioner@node-red-alerts.iam.gserviceaccount.com`, client `114192998402115898583`, with the single `admin.directory.user` scope. The grant is verified. The isolated release configuration has been enabled with delegated administrator `george@charge.rent` and root OU `/`.

Read-only Google Admin checks verified:

- Google Workspace Business Starter is active on the Flexible plan: 20 assigned licenses, $8.40 USD per licensed user per month.
- Gmail is ON for everyone.
- Root organizational unit is `charge.rent`, with only the system Workspace Guests child visible. Use `/` for ordinary new partners.
- The license settings screen exposes only Google Voice automatic licensing (OFF). The single primary Workspace subscription assigns new-user licenses automatically; Google documents that the primary subscription's automatic licensing cannot be changed when the other subscriptions are secondary add-ons: <https://knowledge.workspace.google.com/admin/billing/about-automatic-licensing-for-organizational-units>.

No subscription, license, organizational unit, or Gmail settings were changed. Creating a licensed partner later will add to the existing monthly bill.

## Prepared release

Live dashboard baseline was verified as clean commit `d0e6ebb8880dbbdc079d99fef320870c8986dc9a` in `/home/george/client-dashboard` on GCP `kiosk-monitoring`, `34.56.244.66`. The web root is `/var/www/portal`, served at `https://chargerentstations.com/portal/`. Its saved deployment script pulls `main`; it must not be used to publish this isolated, uncommitted feature artifact.

- Frontend staging: `/private/tmp/chargerent-workspace-frontend-xgul1o2n`.
- Frontend artifact: `portal-dist.tar.gz`, SHA-256 `4a1f7af2172290e968b82a2647ab67ec722644e86ac708d40341b2b40ded4e2e`.
- Backend/rules staging: `/private/tmp/chargerent-workspace-release-99a333UC`.

Both staging directories exclude unrelated local changes. Read their release manifests and validation records before deployment. Preserve a web-root backup and existing `mdm/*.apk` files. Deploy the matching Firestore rules and account/email functions, including the profile-update functions that use the protected mailbox-summary sanitizer, before publishing the frontend.

Before activation on September 9 UTC, refreshed checks confirmed the original live commit/index hash, HTTP 200, and 17 GB free disk. The verified frontend artifact and guarded rollout/rollback scripts were uploaded to `/home/george/dashboard-releases/workspace-email-4a1f7af21722` on the GCP host. Local `ROLLOUT.md` records the commands. The backend dotenv file contains the verified administrator, root OU, and enabled flag. `VERIFY.md` and `verify-workspace-live.cjs` provide token-safe authenticated read-only checks; their final successful results supersede the initial undeployed 404 checks.

## Final activation checks

After Google Admin approval, configure the verified delegated administrator and optional organizational unit, the dedicated service account above, domain `charge.rent`, the single trusted dashboard UID, and `WORKSPACE_PROVISIONING_ENABLED=true`. Bind the existing Gmail secret to creation and retry functions as documented in the feature setup guide. Verify the deployed status and a read-only address-availability request through the real Directory API. Do not create a test mailbox or send a test email without a named, authorized recipient.

Cloud API enablement and signing setup alone do not establish that Google Workspace authorization, licensing, or application deployment is complete.

## Completed deployment and verification

- Scoped Firestore mailbox-protection rules compiled and deployed successfully.
- All 14 selected account/email Functions deployed successfully from the isolated release directory. The active legacy alias `admin_upsertUser` was subsequently deployed on its own so it also uses the protected mailbox-summary sanitizer (15 Functions total).
- Authenticated HTTP and callable status checks returned enabled. The real Directory API correctly reported `george@charge.rent` unavailable and an unused probe address available through both transports (six checks). No mailbox was created. Initial 401 responses during deployment came from the invocation layer and cleared with unchanged code/auth configuration; the exact transient propagation cause is unproven.
- Frontend rollout scripts were corrected before activation to normalize public asset permissions (`D755,F644`) and exclude the entire `/mdm/` subtree. Existing MDM descriptors and QR images were newer than the staged baseline and must remain untouched. Before/after checks hash every MDM file. The uploaded frontend artifact itself is unchanged.
- Frontend activated at `2026-09-09T03:42:43Z`, release marker `d0e6ebb+workspace-email-4a1f7af21722`. Public index, AdminPage asset, and marker match the uploaded release. All MDM file hashes stayed unchanged. Backup: `/home/george/dashboard-releases/workspace-email-4a1f7af21722/backup`.
- Final cloud audit passed 15/15 Functions: ACTIVE, Node.js 24, exact Workspace environment, runtime service account, timeouts, and Gmail secret references. Both unauthenticated status endpoints reject with 401 without configuration disclosure. Sanitized reports are `postdeploy-cloud-audit.json`, `postdeploy-endpoint-probe.json`, and `postdeploy-unauthenticated-probe.json` in the backend release directory.
- Live Chrome form verified: contact email required; company mailbox and kit controls absent for ordinary users and admins; partner checkbox enabled; `George Gazelian` defaults to `g.gazelian@charge.rent`; availability lookup succeeds. Selecting the kit checks the dashboard login email option, and clearing the login email option clears the kit. Switching to admin removes partner options. Test form canceled without submission, then a clean partner form was left open.
- Chrome initially reused the old HTML on same-URL navigation. Loading `https://chargerentstations.com/portal/?release=workspace-email-4a1f7af21722` loaded verified `index-5b0be43f.js` and the new form. Origin HTML and compressed responses were correct; no stale gzip sidecar or service-worker fetch cache was found. No server caching setting was changed.

The feature is active for the trusted `chargerent` dashboard administrator. Actual mailbox creation and message delivery require the intended partner details and remain untested live; activation checks deliberately made only read-only Directory requests.
