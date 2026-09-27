# Optional company email accounts

Partner creation can optionally create an ordinary Google Workspace user. Admin-role recipients and ordinary users are not eligible for company email creation. The requested naming default is first initial, a period, and the last name: `g.gazelian@charge.rent`. Authorized administrators can edit a partner's proposed username before creation. Availability is checked against Google; the final create still checks for a concurrent conflict.

Contact email is required for every new dashboard account. When a partner requests a company mailbox, their contact must be an existing address different from the new company address. Both the form and backend validate it before creating any account.

Dashboard account creation and Google account creation have separate results. A successful Directory API insert creates a Google identity. The UI only calls its mailbox ready when Google returns `isMailboxSetup: true`; otherwise it reports pending activation. Google documents that this flag applies to users with a Gmail license. License assignment and Gmail service enablement remain Workspace administration settings. This integration does not purchase or assign licenses through a billing API. See the [Directory user resource](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users) and [user creation guide](https://developers.google.com/workspace/admin/directory/v1/guides/manage-users).

## Server configuration

The feature stays disabled until all required configuration is present. Configure these only in the Functions environment; do not put them in `VITE_*` variables or browser code:

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_PROVISIONING_ENABLED` | Must be exactly `true` to enable the integration. |
| `WORKSPACE_DOMAIN` | Managed company domain; defaults to `charge.rent`. |
| `WORKSPACE_ADMIN_EMAIL` | Existing Workspace administrator to impersonate for Directory user management. |
| `WORKSPACE_SERVICE_ACCOUNT_EMAIL` | Dedicated Google service account authorized for domain-wide delegation. |
| `WORKSPACE_DASHBOARD_ADMIN_UIDS` | Required comma-separated Firebase Auth UIDs allowed to invoke Workspace operations. Obtain these from trusted Firebase administration, rather than editable profile fields. |
| `WORKSPACE_ORG_UNIT_PATH` | Optional existing organization unit such as `/Partners`, with its intended licensing and Gmail settings. |

The trusted UID allowlist is enforced in the provisioning module and the callable integration. An editable dashboard profile or its `role` field is insufficient authorization for Workspace access. New dashboard admins are not automatically added to the allowlist. Trusted administrators may create company email only for partner recipients; those Google accounts receive no Google administrator privileges.

`getStatus()` reports whether server configuration is complete and enabled. It does not prove that Google authorization or licensing is working. The read-only availability check verifies actual Directory access.

## Google authorization setup

1. Enable the **Admin SDK API** and **IAM Service Account Credentials API** in the intended Google Cloud project.
2. Create or select a dedicated service account for this feature and configure its domain-wide delegation. No downloaded private key is needed by this implementation.
3. Grant the deployed Functions runtime identity `iam.serviceAccounts.signJwt` on that dedicated service account. A narrow custom IAM role can contain this permission; the standard **Service Account Token Creator** role also contains it. If the runtime identity is the same service account, it still needs this signing grant on itself. Limit the grant to the particular signing service account rather than the whole project.
4. In Google Admin Console, a Workspace super administrator authorizes the dedicated service account's numeric OAuth client ID for exactly this scope:

   ```text
   https://www.googleapis.com/auth/admin.directory.user
   ```

5. Set `WORKSPACE_ADMIN_EMAIL` to an existing administrator with the Directory privileges needed to read and create users in the selected organization unit. The API's OAuth scope and the delegated user's administrative privileges must both authorize the request.
6. Confirm that the chosen organization unit has the intended Gmail service and licensing behavior, and that its Workspace subscription has the needed capacity. A successful account insert alone does not establish usable mail delivery.

The runtime obtains its normal Google access token from Firebase Admin credentials, calls IAM `signJwt`, and exchanges that signed assertion for a short-lived token impersonating the configured Workspace admin. Its JWT uses the Directory scope above and a one-hour expiration. Google recommends keyless signing for domain-wide delegation; see [delegation best practices](https://knowledge.workspace.google.com/admin/apps/domain-wide-delegation-best-practices), [IAM signJwt](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt), and [server-to-server OAuth with domain-wide delegation](https://developers.google.com/identity/protocols/oauth2/service-account).

## Provisioning and recovery behavior

The callable validates input and checks Google availability before saving the dashboard account. Once the dashboard account exists, the module returns a separate mailbox result:

| Status | Meaning |
| --- | --- |
| `provisioning` | Another request holds the active creation lease. Refresh its status shortly. |
| `pending` | The owned Google user exists, but Google has not confirmed mailbox setup. Check Gmail licensing/service settings and refresh. |
| `ready` | Google reports the owned account's mailbox is set up. |
| `error` | Mailbox creation or verification failed. The dashboard account remains saved; the result contains a safe, actionable error. |

Provisioning state is stored in the server-only `workspaceProvisioning/{uid}` collection. Its `request` field holds the normalized request needed for retries. Browser profiles receive only a sanitized mailbox summary. Protect the private collection with deny-all client Firestore rules and use the authenticated callables for status and retry operations.

Each Google account created here has the custom `externalIds` marker `dashboardUid` set to its dashboard UID. Google administrators can edit this Directory metadata; the dashboard never relies on email alone to infer ownership. On a retry, the module checks the marker and, once known, Google's immutable user ID. It never adopts an unrelated existing account, resets an existing password, replaces a deleted linked account, or creates a second account after a known account rename. The requested email is bound to the first provisioning record to avoid duplicate users after an uncertain response. Resolve address conflicts in Google Admin rather than changing a saved request to bypass that protection.

Only a successful, directly confirmed insert returns the generated temporary password. It is independent of the dashboard password, and Google requires a password change at the next login. The password is never stored in Firestore or logs. Save it from the creation result if needed; subsequent status refreshes cannot display it again. If an insert succeeded but its response was lost, the module recovers the owned Google account and instructs the administrator to reset its password in Google Admin if the original was not saved. Retrying does not change the password.

A five-minute Firestore transaction lease prevents simultaneous requests from both starting creation. Every HTTP call has a twelve-second timeout. An ambiguous insert response triggers an ownership lookup before any subsequent insert. A failed result write after a successful insert does not discard the one-time password from the immediate response; the ownership marker permits a safe retry.

## Partner address notification

Once the owned Google account is confirmed, the backend automatically emails the partner's new company address and Gmail sign-in link to their contact email. It reuses the existing `sendLoginInviteEmail` Gmail transport, sent by `solutions@charge.rent` with the existing `GMAIL_APP_PASSWORD` secret. This address notification is mandatory when a company account is created; the optional dashboard-login-credentials checkbox controls a separate email.

The notice contains no Google or dashboard password. The administrator saves the one-time Google password shown in the result and supplies it separately. If Gmail activation is pending, the notice explains that the mailbox may not be usable yet.

The original contact email is frozen in the server-only provisioning record. Later changes to profile contact details do not redirect this account notification. Notification state is independent of dashboard account and mailbox state:

| Notification status | Meaning |
| --- | --- |
| `sent` | Gmail SMTP accepted the notice for the contact address. This is not confirmation of inbox delivery. |
| `pending` | Sending is in progress, or Google account confirmation is still needed. |
| `error` | Sending did not start or was explicitly rejected. Use **Retry partner notification** after resolving the cause. |
| `unknown` | The SMTP outcome could not be confirmed. **Send notification again** explicitly permits a possible duplicate. |

Creation and mailbox retries attempt the notification only after confirming the owned Google account. Saved successful sends are not sent again. A transaction lease prevents concurrent send attempts; a timed-out or interrupted attempt is treated as uncertain, never automatically retried. Notification-only retries use `admin_resendWorkspaceNotification` / `admin_httpResendWorkspaceNotification`, enforce the same trusted administrator allowlist, and do not create another Google account or reset passwords.

The create, mailbox-retry, and notification-retry Functions all require the existing Gmail secret binding. SMTP connection and socket timeouts are bounded to let the dashboard report notification failure. No new email provider or separate Gmail integration is introduced.

## Local verification

The local visual preview is available at `/portal/tests/fixtures/workspace-email.html` on the Vite development server. It mounts the real form and result panel with simulated responses; it never sends email or creates an account. The preview is not a production build entry point.

From the repository root:

```bash
node --test scripts/workspace-email.test.mjs scripts/workspace-account-creation.test.mjs functions/workspaceProvisioning.test.js functions/workspaceNotification.test.js
```

From `functions/`:

```bash
./node_modules/.bin/eslint index.js workspaceProvisioning.js workspaceProvisioning.test.js workspaceNotification.js workspaceNotification.test.js
```

Tests use fake Google HTTP and SMTP responses and an in-memory transaction store. They cover authorization/configuration, mandatory contacts, availability, password handling, mailbox activation, ownership collisions, concurrent retries, uncertain API/SMTP responses, recipient binding, and account deletion/rename. The visual preview includes an address-email failure toggle and notification retry. These tests do not create real Google accounts or send emails. Enabling Google authorization, deploying Functions, assigning licenses, or creating a live mailbox are separate operational steps.

## Initial setup audit on September 8, 2026

Read-only inspection of `node-red-alerts` found the IAM Credentials API enabled, but the Admin SDK API disabled. The deployed `admin_httpCreateAuthUserAndProfile` function has no `WORKSPACE_*` environment variables and runs as `176963151151-compute@developer.gserviceaccount.com`. No dedicated Workspace provisioning service account was found. The existing `chargerent` dashboard administrator has UID `yfVaQAuxjhWPzXQhnNYGkxA4qPB3`, which can be the initial trusted UID after configuration is approved. Confirm the Workspace administrator address, delegation, Gmail service, and license settings in Google Admin before enabling the feature.

After the user authorized activation, the Admin SDK API was enabled and a dedicated provisioning service account and narrowly scoped signing grant were created. Google Admin sign-in/authorization and application deployment remain pending. See [activation progress](google-workspace-activation.md) for the verified account, client ID, current access blocker, and isolated release artifacts.

Deployment must include the changed Firestore rules, creation functions, the new status/check/mailbox-retry/notification-retry functions (both HTTP and callable variants if retained), and the dashboard frontend. The create and retry functions bind the existing `GMAIL_APP_PASSWORD` secret. No deployment, email send, or Google account creation was performed during local development.
