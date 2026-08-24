import { ConsoleApp } from '@/components/ConsoleApp';
export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) { const { orgId } = await params; return <ConsoleApp page="organization-detail" orgId={orgId} />; }
