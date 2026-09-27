import test from 'node:test';
import assert from 'node:assert/strict';
import {canEditTerminalSerial, canUseApolloScannerOnly, toGatewayOption, toStoredKioskGateway} from '../src/utils/kioskGateway.js';

test('dashboard gateway labels save the canonical backend values', () => {
  assert.equal(toStoredKioskGateway('P68'), 'PAYTERP68');
  assert.equal(toStoredKioskGateway('APO'), 'APOLLO');
  assert.equal(toStoredKioskGateway('SCAN'), 'SCANNER');
  assert.equal(toStoredKioskGateway('stripe'), 'STRIPE');
});

test('stored gateway values render with the compact dashboard labels', () => {
  assert.equal(toGatewayOption('PAYTERP68'), 'P68');
  assert.equal(toGatewayOption('APOLLO'), 'APO');
  assert.equal(toGatewayOption('SCANNER'), 'SCAN');
  assert.equal(toGatewayOption('stripe'), 'STRIPE');
});

test('terminal serial editing is enabled only for P68 and Apollo gateways', () => {
  assert.equal(canEditTerminalSerial('PAYTERP68'), true);
  assert.equal(canEditTerminalSerial('P68'), true);
  assert.equal(canEditTerminalSerial('APOLLO'), true);
  assert.equal(canEditTerminalSerial('APO'), true);
  assert.equal(canEditTerminalSerial('SCANNER'), false);
  assert.equal(canEditTerminalSerial('STRIPE'), false);
});

test('scanner-only mode is enabled only for Apollo gateways', () => {
  assert.equal(canUseApolloScannerOnly('APOLLO'), true);
  assert.equal(canUseApolloScannerOnly('APO'), true);
  assert.equal(canUseApolloScannerOnly('PAYTERP68'), false);
  assert.equal(canUseApolloScannerOnly('P68'), false);
  assert.equal(canUseApolloScannerOnly('SCANNER'), false);
});
