import { clientPlatformErrorResponse, clientPlatformSuccessResponse } from '@/lib/server/client-platform-api-response';
import { listClientPlatformPublicPlans } from '@/lib/server/client-platform-api-handler';

/** Versioned Client integration surface; public pricing metadata only. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return clientPlatformSuccessResponse(await listClientPlatformPublicPlans());
  } catch (error) {
    return clientPlatformErrorResponse(error);
  }
}
