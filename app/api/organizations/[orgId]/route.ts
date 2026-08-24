import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { getConsoleOrganization } from '@/lib/server/console-read-service';
import { ApiError } from '@/lib/server/api-errors';

export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    await requirePlatformAdmin(request);
    const result = await getConsoleOrganization((await params).orgId);
    if (!result) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    return successResponse(result);
  } catch (error) { return errorResponse(error); }
}
