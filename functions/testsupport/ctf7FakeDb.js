'use strict';
const assert = require('node:assert/strict');
class FakeDb {
  constructor() { this.rows = new Map(); this.sequence = 0; this.tail = Promise.resolve(); }
  snapshot(ref) { const data = this.rows.get(ref.path); return {ref, id: ref.id,
    exists: !!data, data: () => data ? structuredClone(data) : undefined}; }
  collection(name) {
    const db = this;
    return {doc(id = `auto-${db.sequence++}`) {
      const ref = {path: `${name}/${id}`, id}; ref.get = async () => db.snapshot(ref); return ref;
    },
    where(field, operator, value) { return {limit() { return this; }, get: async () => {
      const docs = [...db.rows.keys()].filter(key => key.startsWith(`${name}/`) && (operator === 'in' ? value.includes(db.rows.get(key)[field]) : db.rows.get(key)[field] === value))
        .map(key => db.snapshot({path: key, id: key.split('/').at(-1)}));
      return {docs, empty: !docs.length, size: docs.length};
    }}; }};
  }
  runTransaction(fn) {
    const operation = this.tail.then(async () => {
      const writes = [];
      const tx = {get: async ref => {
        assert.equal(writes.length, 0, 'Firestore forbids reads after writes');
        return ref.path ? this.snapshot(ref) : ref.get();
      }, set: (ref, data) => writes.push([ref.path, structuredClone(data)]),
      delete: ref => writes.push([ref.path, undefined]),
      create: (ref, data) => { assert.equal(this.rows.has(ref.path), false); writes.push([ref.path, structuredClone(data)]); },
      update: (ref, data) => writes.push([ref.path, {...this.rows.get(ref.path), ...structuredClone(data)}])};
      const result = await fn(tx);
      for (const [key, value] of writes) value === undefined ? this.rows.delete(key) : this.rows.set(key, value);
      return result;
    });
    this.tail = operation.catch(() => {}); return operation;
  }
}
module.exports = {FakeDb};
