import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { getSubscriptionOperationsOverview } from '@/lib/server/subscription-operations-service';

export const dynamic = 'force-dynamic';

/** Read-only, platform-admin subscription operations projection. */
export async function GET(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    return successResponse({ overview: await getSubscriptionOperationsOverview() });
  } catch (error) { return errorResponse(error); }
}
