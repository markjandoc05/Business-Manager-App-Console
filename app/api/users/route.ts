import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { ApiError } from '@/lib/server/api-errors';
import { listOrganizationMembershipPage } from '@/lib/server/organization-operations-service';
import type { OrganizationMembershipFilters } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId');
    if (!organizationId) throw new ApiError('INVALID_REQUEST', 'organizationId is required for membership reads.', 400);
    const filters = {
      query: searchParams.get('query') || undefined,
      status: searchParams.get('status') || undefined,
    } as OrganizationMembershipFilters;
    return successResponse(await listOrganizationMembershipPage(organizationId, filters, searchParams.get('cursor') || undefined));
  } catch (error) { return errorResponse(error); }
}
