import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type DataScope = {
  userId: string;
  organizationId?: string;
};

export function scopeWhere(
  userIdColumn: AnyPgColumn,
  organizationIdColumn: AnyPgColumn,
  scope: DataScope,
) {
  return and(
    eq(userIdColumn, scope.userId),
    scope.organizationId
      ? eq(organizationIdColumn, scope.organizationId)
      : isNull(organizationIdColumn),
  );
}
