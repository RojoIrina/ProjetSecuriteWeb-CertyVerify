// ================================================================
// ENV CONFIG — Zod-validated environment variables
// Fails fast at startup if any required var is missing/invalid
// ================================================================
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),

  // JWT RSA key paths
  JWT_PRIVATE_KEY_PATH: z.string().default('./keys/jwt-private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('./keys/jwt-public.pem'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Security
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(14).default(12),
  QR_HMAC_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000), // 15 min
  RATE_LIMIT_MAX: z.coerce.number().default(100),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables.
 * Throws a descriptive error at startup if config is invalid.
 */
function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
