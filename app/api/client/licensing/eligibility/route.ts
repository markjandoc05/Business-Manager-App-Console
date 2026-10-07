import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { bearerToken } from '@/lib/server/client-organization-auth';
import { handleClientSubscriptionEligibility } from '@/lib/server/client-subscription-handler';
import { readJsonBody } from '@/lib/server/request';

export async function POST(request: NextRequest) {
  try { return successResponse(await handleClientSubscriptionEligibility(bearerToken(request), await readJsonBody(request))); } catch (error) { return errorResponse(error); }
}
