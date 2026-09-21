-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateTable
CREATE TABLE "app"."app_user" (
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "app"."token_metadata" (
    "chain_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT,
    "description" TEXT,
    "image_uri" TEXT,
    "image_cdn_url" TEXT,
    "socials" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt" TIMESTAMP(3),
    "fetched_at" TIMESTAMP(3),

    CONSTRAINT "token_metadata_pkey" PRIMARY KEY ("chain_id","token")
);

-- CreateTable
CREATE TABLE "app"."comment" (
    "id" BIGSERIAL NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."report" (
    "id" BIGSERIAL NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "reporter" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "token_metadata_status_next_attempt_idx" ON "app"."token_metadata"("status", "next_attempt");

-- CreateIndex
CREATE INDEX "comment_chain_id_token_created_at_idx" ON "app"."comment"("chain_id", "token", "created_at" DESC);

-- CreateIndex
CREATE INDEX "report_resolved_created_at_idx" ON "app"."report"("resolved", "created_at");

-- AddForeignKey
ALTER TABLE "app"."comment" ADD CONSTRAINT "comment_author_fkey" FOREIGN KEY ("author") REFERENCES "app"."app_user"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."report" ADD CONSTRAINT "report_reporter_fkey" FOREIGN KEY ("reporter") REFERENCES "app"."app_user"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express a length check. Enforce the 500-character comment limit in the database as well as in
-- the API, so no code path can store a longer one (spec §4.2).
ALTER TABLE "app"."comment" ADD CONSTRAINT "comment_body_len" CHECK (char_length("body") <= 500);
