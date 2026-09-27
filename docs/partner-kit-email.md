# Partner kit with dashboard login email

Partner creation has an optional **Include partner kit with login details** checkbox. Selecting it also selects the dashboard-login email option. The existing **Set and send password** dialog has the same partner-only option for an existing account. Both options start unchecked.

When selected, the existing Gmail sender attaches the launch kit PDF to the same email as the partner's dashboard username, password, and login link. It uses `solutions@charge.rent`, the required contact email, the existing administrator CC behavior, and the existing `GMAIL_APP_PASSWORD` secret. It does not send a second credentials email. The separate company-address notification remains independent and contains no passwords or kit.

Only accounts whose role is `partner` may receive the kit through these options. The server validates the role and its fixed attachment before creating an account or changing a password. Browser-supplied file paths, URLs, and attachment contents cannot select a different file. A missing or invalid kit fails before those changes; an SMTP failure after account creation is reported separately from account creation.

## Where the kit lives

The backend needs access to the PDF when it sends an email. This implementation bundles it with Firebase Functions at:

```text
functions/assets/Chargerent_Regional_Partner_Launch_Kit.pdf
```

There is no public download URL or extra server to manage. The PDF will be included in the normal Functions deployment. It is not included in the frontend's public assets. No deployment or live message was sent while developing this feature.

The attachment is an exact copy of the output from the **Partner kit** task (`01a08297-2657-7a10-bf0f-90819d698d0a`):

```text
/Users/georgegazelian/Projects/Marketing assets/output/pdf/Chargerent_Regional_Partner_Launch_Kit_CT3_CT12_CK24_CK48.pdf
```

Verified September 8, 2026: 14 pages, 6,512,678 bytes. It includes the CT3, CT12, CK24, CK48 product guide, updated partner portal page, brand guide, and blank regional representative agreement. SHA-256:

```text
b3ce849625b6d3505e69daa06ceb98fed57b8b0ea508cb153aff960787234491
```

To replace the kit later, verify the new approved PDF, replace the bundled file, rerun its validation and email tests, then deploy the affected Functions. Changes to the Marketing assets source do not automatically replace the deployed attachment.

The existing Nodemailer transport supports PDF attachments through its message options; see the [official attachment documentation](https://nodemailer.com/message/attachments).

## Local testing

Use the existing company-email development preview at `/portal/tests/fixtures/workspace-email.html`. Choose the partner role, enter a valid contact email, and select **Include partner kit with login details**. The preview simulates delivery and exposes the safe request fields; it does not create accounts or send emails.

The automated tests use local files and mocked services. They verify that selecting the kit produces one combined credentials email, rejects ineligible roles or a missing attachment before account/password changes, and preserves the existing login-only and Workspace notification behavior.

```bash
node --test functions/partnerKit.test.js scripts/workspace-account-creation.test.mjs scripts/workspace-email.test.mjs functions/workspaceProvisioning.test.js functions/workspaceNotification.test.js
```

The attachment test uses Nodemailer's local stream transport, decodes the generated MIME attachment, and compares its SHA-256 with the bundled PDF. It does not connect to Gmail. The live delivery result checks acceptance for the partner's contact address, so an accepted administrator CC cannot mask a rejected partner recipient.

Release scope for this option: the dashboard frontend and both callable/HTTP variants of `admin_createAuthUserAndProfile` and `admin_sendLoginInvite`, including `partnerKit.js` and its bundled asset. The partner-kit option works independently of Google Workspace mailbox provisioning.
