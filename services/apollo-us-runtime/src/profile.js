import {z} from 'zod';
import {APOLLO_TERMINAL_GATEWAY, normalizeSerial} from './contracts.js';

const qrConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['chargerent-issued', 'external', 'library']).default('chargerent-issued'),
  promptTitle: z.string().trim().min(1).max(120).default('Borrow a charger'),
  promptMessage: z.string().trim().min(1).max(240).default('Scan your QR code'),
}).strict();

export const apolloReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().trim().min(1).max(160),
  clientId: z.string().trim().min(1).max(120),
  profileVersion: z.number().int().positive(),
  sectionVersion: z.number().int().positive(),
  environment: z.enum(['us-lab', 'us-prod']),
  content: z.object({
    translations: z.record(z.string(), z.unknown()),
    screenFlow: z.record(z.string(), z.unknown()),
    template: z.record(z.string(), z.unknown()).optional(),
    qr: qrConfigSchema.default({enabled: false, provider: 'chargerent-issued', promptTitle: 'Borrow a charger', promptMessage: 'Scan your QR code'}),
  }).strict(),
}).passthrough();

export async function resolveTerminalProfile(db, environment, serialNumber) {
  const serial = normalizeSerial(serialNumber);
  const terminalRef = db.collection('apolloTerminalRegistry').doc(serial);
  const terminalSnap = await terminalRef.get();
  if (!terminalSnap.exists) throw new Error('Terminal is not registered in the Apollo runtime.');
  const terminal = terminalSnap.data() || {};
  if (terminal.environment !== environment || terminal.enabled !== true) throw new Error('Terminal is not enabled in this environment.');
  if (String(terminal.gateway || '').toUpperCase() !== APOLLO_TERMINAL_GATEWAY) throw new Error('Terminal gateway must be APOLLO.');

  const clientId = String(terminal.clientId || '').trim().toUpperCase();
  const stationId = String(terminal.stationId || '').trim().toUpperCase();
  if (!clientId || !stationId) throw new Error('Terminal registration is incomplete.');

  const assignmentSnap = await db.collection('apolloClientAssignments').doc(clientId).get();
  if (!assignmentSnap.exists) throw new Error('No Apollo profile is assigned to this client.');
  const assignment = assignmentSnap.data() || {};
  if (assignment.environment !== environment || assignment.enabled !== true) throw new Error('Client profile assignment is not enabled in this environment.');

  const releaseId = String(assignment.releaseId || '').trim();
  const releaseSnap = releaseId ? await db.collection('apolloProfileReleases').doc(releaseId).get() : null;
  if (!releaseSnap?.exists) throw new Error('Assigned Apollo profile release was not found.');
  const release = apolloReleaseSchema.parse(releaseSnap.data());
  if (release.environment !== environment || release.clientId !== clientId) throw new Error('Assigned Apollo profile release does not match this terminal.');
  return {assignment, clientId, release, releaseId, serial, stationId, terminal};
}

export async function resolveTerminalProfileByStation(db, environment, stationValue) {
  const stationId = String(stationValue || '').trim().toUpperCase();
  if (!stationId) throw new Error('Station ID is required.');
  const snapshot = await db.collection('apolloTerminalRegistry').where('stationId', '==', stationId).limit(3).get();
  const candidates = snapshot.docs.filter((doc) => {
    const terminal = doc.data() || {};
    return terminal.environment === environment
      && terminal.enabled === true
      && String(terminal.gateway || '').toUpperCase() === APOLLO_TERMINAL_GATEWAY;
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1) throw new Error(`Multiple Apollo terminals are registered for station ${stationId}.`);
  return resolveTerminalProfile(db, environment, candidates[0].id);
}
