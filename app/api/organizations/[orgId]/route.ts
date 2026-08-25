import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { getConsoleOrganization } from '@/lib/server/console-read-service';
import { ApiError } from '@/lib/server/api-errors';
import { updateOrganizationProfile } from '@/lib/server/organization-admin-service';
import { readJsonBody } from '@/lib/server/request';

export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    await requirePlatformAdmin(request);
    const result = await getConsoleOrganization((await params).orgId);
    if (!result) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    return successResponse(result);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await updateOrganizationProfile((await params).orgId, await readJsonBody(request), actor));
  } catch (error) { return errorResponse(error); }
}
