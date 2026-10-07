import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { bearerToken } from '@/lib/server/client-organization-auth';
import { handleClientSubscriptionStatus } from '@/lib/server/client-subscription-handler';
import { validateOrganizationId } from '@/lib/server/request';

export async function GET(request: NextRequest) {
  try {
    const organizationId = validateOrganizationId(request.nextUrl.searchParams.get('organizationId'));
    return successResponse(await handleClientSubscriptionStatus(bearerToken(request), organizationId));
  } catch (error) { return errorResponse(error); }
}
