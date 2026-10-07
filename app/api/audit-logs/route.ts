import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { listConsoleAuditLogs } from '@/lib/server/console-read-service';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || 100);
    const cursor = url.searchParams.get('cursor') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;
    return successResponse(await listConsoleAuditLogs(Number.isFinite(limit) ? limit : 100, cursor, organizationId));
  } catch (error) { return errorResponse(error); }
}
