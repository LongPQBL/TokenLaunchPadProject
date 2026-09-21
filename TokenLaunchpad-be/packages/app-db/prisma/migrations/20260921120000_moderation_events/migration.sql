-- What moderators did, one row for each change that happened.
CREATE TABLE "app"."moderation_event" (
    "id" BIGSERIAL NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "moderation_event_chain_id_created_at_idx" ON "app"."moderation_event"("chain_id", "created_at" DESC);
