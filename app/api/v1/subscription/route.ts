import { clientPlatformErrorResponse, clientPlatformSuccessResponse } from '@/lib/server/client-platform-api-response';
import { getClientPlatformSubscription } from '@/lib/server/client-platform-api-handler';
import { bearerToken } from '@/lib/server/client-organization-auth';

/** Versioned Client integration surface for a member-authorized workspace. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspaceId') || '';
    return clientPlatformSuccessResponse(await getClientPlatformSubscription(bearerToken(request), workspaceId));
  } catch (error) {
    return clientPlatformErrorResponse(error);
  }
}
