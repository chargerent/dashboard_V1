import {z} from 'zod';

const configSchema = z.object({
  APOLLO_ENVIRONMENT: z.enum(['us-lab', 'us-prod']).default('us-lab'),
  AVAILABILITY_MIN_DISPLAY_MS: z.coerce.number().int().min(0).max(10000).default(0),
  CALLBACK_TOKEN_SECRET: z.string().trim().min(1).default('apollo-us-lab-callback-token'),
  CPS_ENVIRONMENT: z.enum(['test', 'dev', 'production']).default('test'),
  FIRESTORE_DATABASE: z.string().trim().min(1).default('apollo-us-lab'),
  GOOGLE_CLOUD_PROJECT: z.string().trim().min(1),
  INTERNAL_HMAC_SECRET: z.string().trim().min(1).default('apollo-us-lab-internal-hmac'),
  PAYTER_API_KEY_SECRET: z.string().trim().min(1).default('apollo-us-lab-payter-cps-api-key'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url(),
  PUBSUB_SUBSCRIPTION: z.string().trim().min(1).default('apollo-us-lab-runtime'),
  PUBSUB_TOPIC: z.string().trim().min(1).default('apollo-us-lab-events'),
  QR_HASH_SECRET: z.string().trim().min(1).default('apollo-us-lab-qr-hash-key'),
  QR_READER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
  QR_READER_STATE_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  QR_READER_STATE_POLL_MS: z.coerce.number().int().min(100).max(5000).default(750),
  SCREEN_RETURN_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(7000),
  TERMINAL_RECOVERY_POLL_MS: z.coerce.number().int().min(1000).max(300000).default(5000),
  V2_MQTT_CREDENTIALS_SECRET: z.string().trim().min(1).default('BESITER_MQTT_CREDENTIALS'),
  V2_MQTT_URL: z.string().url(),
}).passthrough();

export function loadConfig(env = process.env) {
  return configSchema.parse(env);
}
