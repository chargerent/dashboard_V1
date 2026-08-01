import assert from 'node:assert/strict';
import test from 'node:test';

import { formatModuleFirmwareVersion } from '../src/utils/firmwareVersion.js';

test('combines the two reported firmware bytes into V1059', () => {
    assert.equal(formatModuleFirmwareVersion(4, 35), 'V1059');
});

test('combines the previous US8006 bytes into V1047', () => {
    assert.equal(formatModuleFirmwareVersion(4, 23), 'V1047');
});

test('accepts zero in either byte when the combined version is non-zero', () => {
    assert.equal(formatModuleFirmwareVersion(4, 0), 'V1024');
    assert.equal(formatModuleFirmwareVersion(0, 35), 'V35');
});

test('returns a placeholder for absent or invalid byte values', () => {
    assert.equal(formatModuleFirmwareVersion(0, 0), '---');
    assert.equal(formatModuleFirmwareVersion(undefined, 35), '---');
    assert.equal(formatModuleFirmwareVersion(4, 256), '---');
    assert.equal(formatModuleFirmwareVersion(4.5, 35), '---');
});
