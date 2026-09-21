import { prisma } from "@vezta/app-db";

/**
 * Empties the app's tables that hang off a person, in the order the foreign keys allow. Every test that needs a clean slate
 * calls this rather than its own list: a list that leaves one table out breaks whichever test file runs after another that used it.
 */
export async function resetAppData(): Promise<void> {
  await prisma.moderationEvent.deleteMany();
  await prisma.report.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.tokenMetadata.deleteMany();
  await prisma.appUser.deleteMany();
}
