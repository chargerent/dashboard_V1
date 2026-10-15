# Client campaign workspace

Campaigns live in **Client profiles / UI Editor → select a client → Campaigns**.
The former Media Control campaign shortcut opens this workspace. Legacy media
remains in Media Control. Campaign-only partner users receive the client selector
and campaign tools without permission to edit checkout, payment, or UI profiles.

Every new campaign and saved edit records `clientId` from the selected client.
`createdBy` and `updatedBy` identify the operator. `managingPartnerId` is separate
from the actual client; the previous `ownerClientId` partner field is migrated
when an existing campaign is saved. Server checks apply to admins and partners:
all selected stations must have the campaign's actual client assignment, and
partners must additionally have access through the station's managing partner.
Publication rechecks the current integrated app assignment and owner-background
capability. Changing a campaign's established client is rejected.

## Editing and publication

- The list shows draft/published state, published kiosks, last publication time,
  and current delivery status. **Edit** loads the complete saved campaign.
- **Save draft** persists edits without changing station assignments or playback.
  Drafts can be saved before selecting kiosks once their media layout is valid.
- **Review & publish** names the affected kiosks and warns about replacing another
  campaign. The server verifies the reviewed existing assignment IDs again.
- Edits retain the campaign ID, existing orientation, zone IDs/geometry,
  playlist timing/rotation/fit, popup messages, and checkout settings. The client
  profile remains authoritative for checkout presentation.
- An edit version rejects stale browser sessions. Campaign mutations are
  serialized, and failed persistence restores campaign/assignment state.
- Five previous publications are retained per campaign. **Restore previous draft**
  prepares the previous publication for review without publishing it.
- Leaving an unsaved editor prompts before discarding changes.

## Existing campaigns

At hosted service startup, legacy campaigns receive a stored client only when
every current published kiosk resolves to the same non-empty client ID. This
metadata migration preserves manifests, revisions, station assignments and
playback. Reading the list never writes state. Ambiguous or empty legacy
assignments remain in the unfiltered admin listing for explicit review. They
never appear in a selected client's campaign list and cannot be published across
multiple clients.

The dashboard also filters older service responses that ignore the client query.
Legacy campaigns without a saved client appear only when every published target
is verified as belonging to the selected client. Campaign names are never used
as ownership evidence. Creating/editing stays disabled until the service returns
`capabilities.clientCampaigns: 1`, preventing the old API from dropping ownership
or accepting unsupported edits.

## Paired release

The local dashboard changes require the matching hosted media API changes in
`/Users/georgegazelian/Documents/ChatGPT/Chargerent Media app/lab/`:

- `campaigns.mjs`: campaign ownership, drafts, edit versions, history, publication.
- `server.mjs`: campaign detail/draft/restore routes and campaign store integration.
- `hosted-auth.mjs`: narrowly allow the new routes for permitted partners.
- `firestore-station-source.mjs`: client discovery and current app assignment checks.

API additions are `GET /api/campaign-clients`, client-filtered `GET /api/campaigns`,
`GET /api/campaigns/:id`, `POST /api/campaigns/draft`, and
`POST /api/campaigns/:id/restore`. Campaign writes require `clientId`; updates
require `id` and `expectedVersion`. Publishing replacements additionally supplies
`expectedAssignments` keyed by station ID.

Production has not been changed by this implementation. Release the backend and
dashboard together; the previous dashboard does not supply mandatory client IDs.
Before an authorized release, follow `docs/media-service-storage.md`, back up only
the changed runtime files and persistent campaign state, and compare against the
current live files so unrelated local changes are not deployed accidentally.
No APK update is needed for campaign editing or client ownership.

## Validation

- Dashboard unit checks: campaign payload round-trip, inventory capability,
  navigation, existing UI profile isolation and wizard behavior.
- Hosted integration checks: actual client enforcement, partner scope, complete
  edits, draft isolation, stale-edit rejection, replacement review, history,
  legacy ownership discovery, persistence recovery and app enrollment checks.
- Browser checks: per-client lists within UI Editor, loading/saving/publishing
  the same campaign after review, kiosk filtering, unsaved-change handling.
  `tests/fixtures/client-campaigns.html` uses browser-only sample data; it never
  writes production. `?workspace=profiles` previews the integrated client tab.
