import { PrismaClient } from "@prisma/client";

// One client per process. In development a hot reload would otherwise open a new connection pool
// on every edit and exhaust Postgres's connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "@prisma/client";
