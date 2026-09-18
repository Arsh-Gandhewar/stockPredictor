-- CreateTable
CREATE TABLE IF NOT EXISTS "distributed_locks" (
    "lock_key" VARCHAR(128) NOT NULL,
    "owner_id" VARCHAR(256) NOT NULL,
    "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMPTZ NOT NULL,
    "fencing_token" BIGINT NOT NULL DEFAULT 1,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "distributed_locks_pkey" PRIMARY KEY ("lock_key")
);
