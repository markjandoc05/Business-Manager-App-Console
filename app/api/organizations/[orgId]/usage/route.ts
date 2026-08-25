import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { getOrganizationUsage } from '@/lib/server/organization-usage-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request);
    const { orgId } = await params;
    return successResponse({ ...await getOrganizationUsage(orgId), viewerRole: actor.role });
  } catch (error) { return errorResponse(error); }
}
