import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { listOrganizationRegistryPage } from '@/lib/server/organization-operations-service';
import type { OrganizationRegistryFilters } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const { searchParams } = new URL(request.url);
    const filters = {
      query: searchParams.get('query') || undefined,
      plan: searchParams.get('plan') || undefined,
      licenseStatus: searchParams.get('licenseStatus') || undefined,
      platformStatus: searchParams.get('platformStatus') || undefined,
      creationDate: searchParams.get('creationDate') || undefined,
      lifecycle: searchParams.get('lifecycle') || undefined,
    } as OrganizationRegistryFilters;
    return successResponse(await listOrganizationRegistryPage(filters, searchParams.get('cursor') || undefined));
  } catch (error) { return errorResponse(error); }
}
