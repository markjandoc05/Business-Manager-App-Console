import { NextRequest } from 'next/server';
import { handleLicenseRequest } from '@/lib/server/license-route';

export async function POST(request: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  return handleLicenseRequest(request, (await params).orgId, 'renew');
}
