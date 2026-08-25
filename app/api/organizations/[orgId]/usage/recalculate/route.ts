import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { recalculateOrganizationUsage } from '@/lib/server/organization-usage-service';

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    const { orgId } = await params;
    return successResponse(await recalculateOrganizationUsage(orgId, actor));
  } catch (error) { return errorResponse(error); }
}
