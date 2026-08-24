import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-errors';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { updatePlatformAdmin } from '@/lib/server/platform-admin-service';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) { try { const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']); return successResponse(await updatePlatformAdmin(request, (await params).uid, actor)); } catch (error) { return errorResponse(error); } }
