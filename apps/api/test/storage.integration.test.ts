import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { S3BlobStore } from '../src/storage/blobStore';

// Explicit opt-in for a disposable local S3 service. CI supplies a fresh Garage
// bucket; normal unit tests never contact a production storage endpoint.
const endpoint = process.env['S3_TEST_ENDPOINT'];
const bucket = process.env['S3_TEST_BUCKET'] ?? 'qa-chatforge';
if (endpoint && !['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname)) {
  throw new Error('Storage integration tests require a loopback-only endpoint');
}
if (endpoint && (!bucket.startsWith('qa-') || !process.env['S3_TEST_ACCESS_KEY'] || !process.env['S3_TEST_SECRET_KEY'])) {
  throw new Error('Storage integration tests require a disposable qa- bucket and explicit test credentials');
}

describe.skipIf(!endpoint)('real S3 storage contract', () => {
  const cfg = {
    endpoint: endpoint ?? 'http://127.0.0.1:3900',
    region: 'us-east-1',
    bucket,
    accessKey: process.env['S3_TEST_ACCESS_KEY'] ?? '',
    secretKey: process.env['S3_TEST_SECRET_KEY'] ?? '',
  };
  const store = new S3BlobStore(cfg);
  const key = `integration-test/${randomUUID()}`;

  afterAll(async () => { await store.delete(key); });

  it('preserves bytes and metadata, enforces authentication, and deletes only its fixture', async () => {
    await store.ensureBucket();
    const bytes = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    await store.put(key, bytes, { contentLength: bytes.length, contentType: 'application/octet-stream' });
    const fetched = await store.get(key);
    expect(fetched).not.toBeNull();
    expect(fetched!.contentLength).toBe(bytes.length);
    expect(fetched!.contentType).toBe('application/octet-stream');
    expect(new Uint8Array(await new Response(fetched!.stream).arrayBuffer())).toEqual(bytes);

    const anonymous = await fetch(`${cfg.endpoint}/${bucket}/${key}`);
    expect(anonymous.status).toBe(403);
    const wrongCredentials = new S3BlobStore({ ...cfg, secretKey: 'intentionally-wrong-test-credential' });
    await expect(wrongCredentials.get(key)).rejects.toThrow();

    const client = new S3Client({
      endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
    try {
      await expect(client.send(new CreateBucketCommand({ Bucket: 'qa-forbidden-new-bucket' })))
        .rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
      await expect(client.send(new DeleteBucketCommand({ Bucket: bucket })))
        .rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
    } finally { client.destroy(); }

    const container = process.env['S3_TEST_CONTAINER'];
    if (container) {
      if (process.env['GITHUB_ACTIONS'] !== 'true' || !/^cf-ci-[a-f0-9]{12}-garage-1$/.test(container)) {
        throw new Error('Restart tests require the exact disposable CI container');
      }
      execFileSync('docker', ['exec', container, '/garage', 'meta', 'snapshot'], { stdio: 'pipe', timeout: 15000 });
      execFileSync('docker', ['restart', '--time=20', container], { stdio: 'pipe', timeout: 30000 });
      await expect.poll(async () => {
        try { return execFileSync('docker', ['exec', container, 'test', '-f', '/tmp/garage-ready']).length === 0; }
        catch { return false; }
      }, { timeout: 30000 }).toBe(true);
      const afterRestart = await store.get(key);
      expect(afterRestart).not.toBeNull();
      expect(new Uint8Array(await new Response(afterRestart!.stream).arrayBuffer())).toEqual(bytes);
    }

    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  }, 90000);
});
