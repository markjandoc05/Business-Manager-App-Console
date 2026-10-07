import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { listConsoleAuditLogs } from '@/lib/server/console-read-service';
import type { PlatformAuditActorRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || 25);
    const cursor = url.searchParams.get('cursor') || undefined;
    return successResponse(await listConsoleAuditLogs(Number.isFinite(limit) ? limit : 25, cursor, {
      dateFrom: url.searchParams.get('dateFrom') || undefined,
      dateTo: url.searchParams.get('dateTo') || undefined,
      action: url.searchParams.get('action') || undefined,
      organizationId: url.searchParams.get('organizationId') || undefined,
      actorRole: (url.searchParams.get('actorRole') || undefined) as PlatformAuditActorRole | undefined,
      targetType: url.searchParams.get('targetType') || undefined,
    }));
  } catch (error) { return errorResponse(error); }
}
