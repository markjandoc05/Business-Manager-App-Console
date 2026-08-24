import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { listConsoleMemberships } from '@/lib/server/console-read-service';

export async function GET(request: NextRequest) {
  try { await requirePlatformAdmin(request); return successResponse(await listConsoleMemberships()); } catch (error) { return errorResponse(error); }
}
