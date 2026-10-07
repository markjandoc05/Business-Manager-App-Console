import { clientPlatformErrorResponse, clientPlatformSuccessResponse } from '@/lib/server/client-platform-api-response';
import { provisionClientPlatformTrial } from '@/lib/server/client-platform-api-handler';
import { bearerToken } from '@/lib/server/client-organization-auth';
import { ApiError } from '@/lib/server/api-errors';
import { readJsonBody } from '@/lib/server/request';

/** Versioned Client integration surface for new workspace trial provisioning. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiError('INVALID_REQUEST', 'Content-Type must be application/json.', 400);
    }
    const result = await provisionClientPlatformTrial(
      bearerToken(request),
      await readJsonBody(request),
      request.headers.get('idempotency-key'),
    );
    return clientPlatformSuccessResponse(result, result.idempotent ? 200 : 201);
  } catch (error) {
    return clientPlatformErrorResponse(error);
  }
}
