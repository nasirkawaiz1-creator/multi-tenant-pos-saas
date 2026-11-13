
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DbTransaction } from "@pos/database";
import { withTenantContext } from "@pos/database";

export type TenantDb = DbTransaction;

export async function runWithTenant<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T | undefined> {
  // Use user's tenantId if available, otherwise fallback to 'default-tenant' for zero-login POS use
  const tenantId = request.user?.tenantId ?? "default-tenant";

  return withTenantContext(tenantId, fn);
}
