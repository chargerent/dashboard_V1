# Dashboard resilience baseline

Run the mobile dashboard resilience suite with:

```sh
npm run test:ui-resilience
```

The suite renders the real dashboard components in a test-only Vite page with 20 kiosks, 30 slots per kiosk, and 10,000 rentals. It does not authenticate, connect to Firestore/WebSockets, or send kiosk commands.

Four tests use Playwright's `test.fail(...)` annotation because they document defects that exist before optimization work begins. Those checks still assert the desired end state, but their failures are expected so the baseline command remains usable. Remove the annotation from each test when its production fix is implemented; Playwright treats an unexpected pass as a failure so improvements cannot go unnoticed.

Current target budgets and guarantees:

- fewer than 1,200 rendered DOM nodes, 100 buttons, and 10,000 px of mobile document height for the fixture dataset;
- less than 200 ms for every sampled confirmation open/cancel interaction during 40 ms heartbeat churn;
- one active blocking modal, with the confirmation remaining topmost;
- the last valid kiosk view remains visible while the data connection recovers.

Playwright output and traces are written under `.codex-tmp/`, which is ignored by Git.
