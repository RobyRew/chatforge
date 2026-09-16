import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/env';

afterEach(() => vi.unstubAllEnvs());

describe('storage credential boundary', () => {
  it('does not use legacy object-store administrator credentials', () => {
    vi.stubEnv('S3_ACCESS_KEY', '');
    vi.stubEnv('S3_SECRET_KEY', '');
    vi.stubEnv('MINIO_ROOT_USER', 'old-administrator');
    vi.stubEnv('MINIO_ROOT_PASSWORD', 'old-administrator-test-only');
    expect(loadEnv().s3.configured).toBe(false);
    expect(loadEnv().s3.accessKey).toBe('');
    expect(loadEnv().s3.secretKey).toBe('');
  });

  it('requires both explicit S3 credentials', () => {
    vi.stubEnv('S3_ACCESS_KEY', 'application-test-only');
    vi.stubEnv('S3_SECRET_KEY', '');
    expect(loadEnv().s3.configured).toBe(false);
    vi.stubEnv('S3_SECRET_KEY', 'application-test-secret-only');
    expect(loadEnv().s3.configured).toBe(true);
  });
});
