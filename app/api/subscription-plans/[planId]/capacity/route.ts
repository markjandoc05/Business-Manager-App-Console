import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { ApiError } from '@/lib/server/api-errors';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { readJsonBody } from '@/lib/server/request';
import { updateFoundingCustomerLimit } from '@/lib/server/subscription-plan-service';

/** Dedicated Console-only mutation for the Founding commercial offer capacity. */
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const { planId } = await params;
    if (planId !== 'founding_100') throw new ApiError('NOT_FOUND', 'No configurable capacity exists for this subscription plan.', 404);
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await updateFoundingCustomerLimit(await readJsonBody(request), actor));
  } catch (error) {
    return errorResponse(error);
  }
}
