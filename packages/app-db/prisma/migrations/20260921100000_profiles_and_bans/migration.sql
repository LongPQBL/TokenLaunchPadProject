-- Usernames, avatars and bans arrive now because comments are the first thing that displays them.
ALTER TABLE "app"."app_user" ADD COLUMN "username" TEXT;
ALTER TABLE "app"."app_user" ADD COLUMN "avatar_uri" TEXT;
ALTER TABLE "app"."app_user" ADD COLUMN "banned_at" TIMESTAMPTZ(3);

-- Case-insensitive uniqueness: "Alice" and "alice" must not both exist. Prisma cannot express an index on an expression,
-- so this lives here and not in schema.prisma.
CREATE UNIQUE INDEX "app_user_username_lower" ON "app"."app_user" (lower("username"));

-- Usernames are shown beside other people's content, so keep them boring: letters, digits and underscore, 3 to 20 long.
ALTER TABLE "app"."app_user" ADD CONSTRAINT "app_user_username_shape" CHECK ("username" IS NULL OR "username" ~ '^[A-Za-z0-9_]{3,20}$');

-- Who hid a token, and when.
ALTER TABLE "app"."token_metadata" ADD COLUMN "hidden_by" TEXT;
ALTER TABLE "app"."token_metadata" ADD COLUMN "hidden_at" TIMESTAMPTZ(3);
