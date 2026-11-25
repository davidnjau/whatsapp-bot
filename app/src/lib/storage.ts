import { Client as MinioClient } from 'minio'
import { config } from '../config.js'
import { log } from '../logger.js'

// MinIO/S3 object store. Only used when STORAGE_BACKEND=minio; otherwise the
// media layer stays on local disk and none of this runs.
let client: MinioClient | null = null
let bucketReady = false

export function storageEnabled(): boolean {
  return config.storageBackend === 'minio' && !!config.s3.accessKey && !!config.s3.secretKey
}

function getClient(): MinioClient {
  if (client) return client
  const [host, port] = config.s3.endpoint.split(':')
  client = new MinioClient({
    endPoint: host,
    port: port ? Number(port) : config.s3.useSSL ? 443 : 80,
    useSSL: config.s3.useSSL,
    accessKey: config.s3.accessKey,
    secretKey: config.s3.secretKey,
    region: config.s3.region,
  })
  return client
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const c = getClient()
  const exists = await c.bucketExists(config.s3.bucket).catch(() => false)
  if (!exists) {
    await c.makeBucket(config.s3.bucket, config.s3.region)
    log.info({ bucket: config.s3.bucket }, 'created MinIO bucket')
  }
  bucketReady = true
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket()
  await getClient().putObject(config.s3.bucket, key, body, body.length, {
    'Content-Type': contentType,
  })
}

export async function getObject(key: string): Promise<Buffer> {
  const stream = await getClient().getObject(config.s3.bucket, key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}
