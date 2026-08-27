-- The original `blobs` table was M4 scaffolding (wrapped_key/salt) that no code ever wrote to.
-- P3 replaces it with an access-controlled attachment/avatar registry (see 0009). Dropped rather
-- than migrated because it is guaranteed empty; IF EXISTS keeps a partially-migrated DB safe.
DROP TABLE IF EXISTS "blobs" CASCADE;
