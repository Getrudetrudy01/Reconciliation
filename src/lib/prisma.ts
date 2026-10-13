import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const DEFAULTS = { feeAmount: 0.5, tolerance: 0.02 };

/** Read the singleton settings row, creating it with defaults on first use. */
export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", ...DEFAULTS },
  });
}
