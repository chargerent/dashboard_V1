# Rental dashboard summaries

The main Dashboard reads compact per-station rental summaries after
`rentalDashboardMeta/current.ready` is set to `true`. Until then, it retains the
existing 30-day raw-rental listener as a safe fallback.

## Collections

- `rentalDashboardStats/{stationid}` stores daily count, revenue, initial-charge,
  and `rented`/`lost` counters from the start of the current year, plus the
  rolling 31-day edge needed at New Year.
- `rentalDashboardEvents/{eventIdHash}` deduplicates Firestore event retries.
  The trigger uses each event's before-and-after rental data, so station changes,
  refunds, and deletions update summaries without historical projection writes.
  While a backfill generation is active, these documents temporarily queue
  deltas and reconcile them against the source snapshot's read time.
- `rentalDashboardMeta/current` controls the client cutover.

Dashboard cards subscribe to the summary collection. Raw global rental
listeners are loaded only while Chargers, Analytics, or Testing is open.
Rentals uses bounded page-owned queries (50 documents, default seven days) and
direct exact searches. A kiosk rental drill-down navigates to Rentals with its
station and period scope.

## Release order

1. Deploy the `rentals_updateDashboardStats` Firebase Function.
2. Run the backfill without `--apply` and review its rental and station counts:

   ```sh
   npm --prefix functions run backfill:rental-dashboard-stats
   ```

3. Run the backfill with `--apply`. It keeps the metadata flag false until all
   summaries are written and every concurrent rental event is either confirmed
   inside the source snapshot or applied once afterward:

   ```sh
   npm --prefix functions run backfill:rental-dashboard-stats -- --apply
   ```

4. Compare dashboard totals against the raw rental calculation for several
   stations and locations.
5. Deploy the web dashboard. The client switches automatically when the meta
   document is ready.

If summary reads fail after cutover, the UI retains the last good summary
instead of downloading the entire raw dataset during a transient connection
failure.

## Rollback

Set `rentalDashboardMeta/current.ready` to `false` through an authorized
administrative process, then deploy the previous web version if needed. The
client will use the existing bounded raw-rental listener.
