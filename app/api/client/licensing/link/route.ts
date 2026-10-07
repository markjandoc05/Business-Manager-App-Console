import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { bearerToken } from '@/lib/server/client-organization-auth';
import { handleClientSubscriptionLink } from '@/lib/server/client-subscription-handler';
import { readJsonBody } from '@/lib/server/request';

export async function POST(request: NextRequest) {
  try {
    const result = await handleClientSubscriptionLink(bearerToken(request), await readJsonBody(request));
    return successResponse(result, result.idempotent ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
