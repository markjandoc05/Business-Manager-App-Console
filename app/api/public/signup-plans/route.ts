import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { listPublicSignupPlans } from '@/lib/server/subscription-plan-service';

/** Public pricing metadata only; no organization or CRM data is returned. */
export const dynamic = 'force-dynamic';

export async function GET() {
  try { return successResponse(await listPublicSignupPlans()); } catch (error) { return errorResponse(error); }
}
