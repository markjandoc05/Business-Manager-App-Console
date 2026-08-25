import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { updateOrganizationMember } from '@/lib/server/organization-admin-service';
import { readJsonBody } from '@/lib/server/request';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orgId: string; uid: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    const resolved = await params;
    return successResponse(await updateOrganizationMember(resolved.orgId, resolved.uid, await readJsonBody(request), actor));
  } catch (error) { return errorResponse(error); }
}
