import { z } from 'zod'

const Env = z.object({
  NODE_ENV: z.string().default('production'),
  APP_PORT: z.coerce.number().default(8080),
  APP_BASE_URL: z.string().default('http://localhost:8080'),
  TZ: z.string().default('Africa/Nairobi'),
  LOG_LEVEL: z.string().default('info'),

  WAHA_URL: z.string(),
  WAHA_API_KEY: z.string().min(1),
  WAHA_SESSION: z.string().default('default'),
  WEBHOOK_SECRET: z.string().min(1),
  // Internal URL WAHA calls to reach us; defaults to the compose service name.
  WEBHOOK_URL: z.string().optional(),
  INTERNAL_BASE_URL: z.string().optional(),

  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),

  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai', 'gemini', 'ollama']).default('none'),
  AI_MODEL: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  OLLAMA_URL: z.string().default('http://ollama:11434'),

  BOT_ENABLED: z.enum(['true', 'false']).default('true'),
  BUSINESS_HOURS: z.string().default('Mon-Sat 08:00-18:00'),
  HANDOFF_NUMBER: z.string().default(''),
  MAX_REPLIES_PER_CHAT_PER_HOUR: z.coerce.number().default(30),

  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  ADMIN_API_TOKEN: z.string().min(1),
  SESSION_SECRET: z.string().min(1),

  SHOP_RESERVE_MINUTES: z.coerce.number().default(3),

  // Object storage: 'disk' (local MEDIA_DIR) or 'minio' (self-hosted S3).
  STORAGE_BACKEND: z.enum(['disk', 'minio']).default('disk'),
  S3_ENDPOINT: z.string().default('s3:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('dressnation'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_USE_SSL: z.enum(['true', 'false']).default('false'),

  // RunPod digitization worker (AI ingest). Dormant until the endpoint is set.
  RUNPOD_ENDPOINT: z.string().default(''),
  RUNPOD_API_KEY: z.string().default(''),
  INGEST_CATEGORY: z.string().default('dress'),

  SEND_MIN_DELAY_SECONDS: z.coerce.number().default(3),
  SEND_MAX_DELAY_SECONDS: z.coerce.number().default(10),
  SEND_MAX_PER_HOUR: z.coerce.number().default(200),

  ALERT_WHATSAPP_NUMBER: z.string().default(''),
  ALERT_EMAIL: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
})

const env = Env.parse(process.env)

export const config = {
  nodeEnv: env.NODE_ENV,
  appPort: env.APP_PORT,
  appBaseUrl: env.APP_BASE_URL,
  tz: env.TZ,
  logLevel: env.LOG_LEVEL,

  wahaUrl: env.WAHA_URL,
  wahaApiKey: env.WAHA_API_KEY,
  wahaSession: env.WAHA_SESSION,
  webhookSecret: env.WEBHOOK_SECRET,
  wahaWebhookUrl: env.WEBHOOK_URL ?? `http://app:${env.APP_PORT}/webhooks/waha`,
  // Reachable by the WAHA container (same docker network) to fetch product
  // images — distinct from appBaseUrl, which is the public/customer URL.
  internalBaseUrl: env.INTERNAL_BASE_URL ?? `http://app:${env.APP_PORT}`,

  databaseUrl:
    `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}` +
    `@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`,

  aiProvider: env.AI_PROVIDER,
  aiModel: env.AI_MODEL,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  openaiApiKey: env.OPENAI_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  ollamaUrl: env.OLLAMA_URL,

  botEnabled: env.BOT_ENABLED === 'true',
  businessHours: env.BUSINESS_HOURS,
  handoffNumber: env.HANDOFF_NUMBER,
  maxRepliesPerChatPerHour: env.MAX_REPLIES_PER_CHAT_PER_HOUR,

  adminUsername: env.ADMIN_USERNAME,
  adminPassword: env.ADMIN_PASSWORD,
  adminApiToken: env.ADMIN_API_TOKEN,
  sessionSecret: env.SESSION_SECRET,

  shopReserveMinutes: env.SHOP_RESERVE_MINUTES,

  storageBackend: env.STORAGE_BACKEND,
  s3: {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    useSSL: env.S3_USE_SSL === 'true',
  },
  runpodEndpoint: env.RUNPOD_ENDPOINT,
  runpodApiKey: env.RUNPOD_API_KEY,
  ingestCategory: env.INGEST_CATEGORY,

  sendMinDelaySeconds: env.SEND_MIN_DELAY_SECONDS,
  sendMaxDelaySeconds: env.SEND_MAX_DELAY_SECONDS,
  sendMaxPerHour: env.SEND_MAX_PER_HOUR,

  alertWhatsappNumber: env.ALERT_WHATSAPP_NUMBER,
  alertEmail: env.ALERT_EMAIL,
  smtpHost: env.SMTP_HOST,
  smtpPort: env.SMTP_PORT,
  smtpUser: env.SMTP_USER,
  smtpPassword: env.SMTP_PASSWORD,
}
