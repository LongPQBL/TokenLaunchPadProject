-- One unsettled report per person per token: reporting again while the first is still open adds nothing for a moderator to
-- read, and a partial unique index makes that true even when two requests arrive together. Prisma cannot express a partial
-- index, so this lives here and not in schema.prisma.
CREATE UNIQUE INDEX "report_one_open_per_reporter" ON "app"."report" ("chain_id", "token", "reporter") WHERE NOT "resolved";
