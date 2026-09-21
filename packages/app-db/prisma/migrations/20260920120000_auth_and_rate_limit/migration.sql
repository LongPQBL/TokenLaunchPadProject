-- CreateTable
CREATE TABLE "app"."siwe_nonce" (
    "nonce" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "siwe_nonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "app"."session" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."rate_hit" (
    "id" BIGSERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_hit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "siwe_nonce_expires_at_idx" ON "app"."siwe_nonce"("expires_at");

-- CreateIndex
CREATE INDEX "session_address_idx" ON "app"."session"("address");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "app"."session"("expires_at");

-- CreateIndex
CREATE INDEX "rate_hit_bucket_key_at_idx" ON "app"."rate_hit"("bucket", "key", "at");
