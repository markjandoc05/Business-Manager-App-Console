import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { ApiError } from '@/lib/server/api-errors';
import { listPublicSignupPlans } from '@/lib/server/subscription-plan-service';

export const dynamic = 'force-dynamic';

/** Compatibility form for clients that support one current public plan. */
export async function GET() {
  try {
    const plan = (await listPublicSignupPlans())[0];
    if (!plan) return errorResponse(new ApiError('NOT_FOUND', 'No public signup plan is currently available.', 404));
    return successResponse(plan);
  } catch (error) { return errorResponse(error); }
}
