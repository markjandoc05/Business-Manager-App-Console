import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-error-response';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { addOrganizationMember, lookupExistingOrganizationUser } from '@/lib/server/organization-admin-service';
import { readJsonBody } from '@/lib/server/request';

export async function GET(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    const email = new URL(request.url).searchParams.get('email') || '';
    return successResponse(await lookupExistingOrganizationUser((await params).orgId, email));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']);
    return successResponse(await addOrganizationMember((await params).orgId, await readJsonBody(request), actor), 201);
  } catch (error) { return errorResponse(error); }
}
