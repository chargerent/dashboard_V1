import {SecretManagerServiceClient} from '@google-cloud/secret-manager';

export function createSecretLoader({client = new SecretManagerServiceClient(), projectId, ttlMs = 5 * 60 * 1000}) {
  const cache = new Map();
  return async function loadSecret(secretId) {
    const now = Date.now();
    const cached = cache.get(secretId);
    if (cached && cached.expiresAt > now) return cached.value;
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    const [version] = await client.accessSecretVersion({name});
    const value = version.payload?.data?.toString('utf8').trim();
    if (!value) throw new Error(`Secret ${secretId} has no enabled value.`);
    cache.set(secretId, {expiresAt: now + ttlMs, value});
    return value;
  };
}
