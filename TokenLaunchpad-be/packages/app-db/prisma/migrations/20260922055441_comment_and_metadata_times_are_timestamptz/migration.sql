-- These four columns held a naive timestamp: no timezone of its own, so a value took whatever the writing connection's
-- clock was set to, and gave that same value back AS UTC to whatever asked, whatever the reading connection's clock was
-- set to. On a connection not set to UTC, that mismatch made times land in the future by exactly the connection's offset —
-- which for created_at, on a comment or a report, means it never falls due and reads "just now" forever.
--
-- The plain SET DATA TYPE below is not a no-op: Postgres reinterprets each existing naive value using the SESSION
-- running this migration's own clock, converting it to the true absolute instant it always meant, so no history is lost.
--
-- (Not a DROP INDEX on token_metadata_name_trgm: Prisma's own diff proposed dropping the trigram index from the earlier
-- migration, since nothing in schema.prisma models it — a manually-generated migration.sql knows better.)

-- AlterTable
ALTER TABLE "app"."app_user" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "app"."comment" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "app"."report" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "app"."token_metadata" ALTER COLUMN "next_attempt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "fetched_at" SET DATA TYPE TIMESTAMPTZ(3);
