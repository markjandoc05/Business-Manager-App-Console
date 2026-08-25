import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { setOrganizationStorageLimit } from '@/lib/server/organization-usage-service';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    const { orgId } = await params;
    const body = await request.json().catch(() => ({}));
    return successResponse(await setOrganizationStorageLimit(orgId, body.storageLimitBytes === null ? null : body.storageLimitBytes, actor));
  } catch (error) { return errorResponse(error); }
}
