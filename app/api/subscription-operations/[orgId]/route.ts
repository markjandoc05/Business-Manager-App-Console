import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { getSubscriptionLicenseDetail } from '@/lib/server/subscription-operations-service';

export const dynamic = 'force-dynamic';

/** Returns only the selected organization's subscription/license projection and relevant audit events. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    await requirePlatformAdmin(request);
    return successResponse(await getSubscriptionLicenseDetail((await params).orgId));
  } catch (error) { return errorResponse(error); }
}
