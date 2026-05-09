import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const createPrismaClient = (connectionString: string) => {
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  // Usar 'any' para evitar erros de tipo durante a transição para Prisma 7 no Edge
  return new (PrismaClient as any)({
    adapter
  });
};
