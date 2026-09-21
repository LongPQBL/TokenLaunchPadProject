-- Trigram index for substring search on the resolved token name (spec §5.1). pg_trgm is a trusted
-- extension on Postgres 13+, so the database owner can create it on Neon and Supabase.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "token_metadata_name_trgm" ON "app"."token_metadata" USING gin ("name" gin_trgm_ops);
