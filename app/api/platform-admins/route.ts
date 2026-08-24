import { NextRequest } from 'next/server';
import { errorResponse, successResponse } from '@/lib/server/api-errors';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { createPlatformAdmin, listPlatformAdmins } from '@/lib/server/platform-admin-service';

export async function GET(request: NextRequest) { try { await requirePlatformAdmin(request); return successResponse(await listPlatformAdmins()); } catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) { try { const actor = await requirePlatformAdmin(request, ['SUPER_ADMIN']); return successResponse(await createPlatformAdmin(request, actor), 201); } catch (error) { return errorResponse(error); } }
