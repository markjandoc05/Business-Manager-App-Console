import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { listSubscriptionOperationLicenses } from '@/lib/server/subscription-operations-service';
import type { SubscriptionOperationLicenseFilters } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Bounded read-only page for the Console license-record table. */
export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    const { searchParams } = new URL(request.url);
    const filters = {
      query: searchParams.get('query') || undefined,
      plan: searchParams.get('plan') || undefined,
      status: searchParams.get('status') || undefined,
      renewalPeriod: searchParams.get('renewalPeriod') || undefined,
      trialExpiration: searchParams.get('trialExpiration') || undefined,
    } as SubscriptionOperationLicenseFilters;
    return successResponse(await listSubscriptionOperationLicenses(filters, searchParams.get('cursor') || undefined));
  } catch (error) { return errorResponse(error); }
}
