import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const createPrismaClient = (connectionString: string) => {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  // @ts-ignore - Prisma 7 type support
  return new PrismaClient({
    adapter,
    datasourceUrl: connectionString
  });
};
