/* eslint-env node */

// Providers own their credentials and declare the verified key mode. This
// module only observes account identity; it never reads keys or changes money.
function createStripeReceiptClientResolver({sources = []} = {}) {
  if (!Array.isArray(sources) || sources.some((source) =>
    !source || !["test", "live"].includes(source.mode) || typeof source.getClient !== "function")) {
    throw new TypeError("Configure lazy Stripe sources with an explicit test/live mode.");
  }
  const configured = sources.map(({mode, getClient}) => ({mode, getClient}));
  const verified = new Map();
  return async (accountId, mode) => {
    if (typeof accountId !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
        !["test", "live"].includes(mode)) return null;
    const cacheKey = `${accountId}:${mode}`;
    if (verified.has(cacheKey)) return verified.get(cacheKey);
    const matches = [];
    let unresolvedSource = false;
    for (const source of configured) {
      if (source.mode !== mode) continue;
      try {
        const client = await source.getClient();
        if (!client) {
          unresolvedSource = true;
          continue;
        }
        if (typeof client.accounts?.retrieve !== "function") {
          unresolvedSource = true;
          continue;
        }
        const account = await client.accounts.retrieve();
        if (!account || typeof account.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account.id)) {
          unresolvedSource = true;
          continue;
        }
        if (account.id === accountId) matches.push(client);
      } catch {
        unresolvedSource = true;
      }
    }
    // A failed candidate cannot establish a unique mapping. Unknown mappings
    // are not cached, so a later successful read can recover normally.
    if (unresolvedSource || matches.length !== 1) return null;
    verified.set(cacheKey, matches[0]);
    return matches[0];
  };
}

module.exports = {createStripeReceiptClientResolver};
