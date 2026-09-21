-- Tokens a person has starred.
CREATE TABLE "app"."favorite" (
    "chain_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("chain_id","address","token")
);

CREATE INDEX "favorite_address_chain_id_created_at_idx" ON "app"."favorite"("address", "chain_id", "created_at" DESC);

ALTER TABLE "app"."favorite" ADD CONSTRAINT "favorite_address_fkey" FOREIGN KEY ("address") REFERENCES "app"."app_user"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
