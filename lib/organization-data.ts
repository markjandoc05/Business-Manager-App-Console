import { collection, doc, getCountFromServer, getDoc, getDocs } from 'firebase/firestore';
import { firestore } from './firebase';
import { Organization, OrganizationLicense, OrganizationMember } from './types';

export function firestoreDate(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return undefined;
}

export function organizationFromData(id: string, data: Record<string, unknown>): Organization {
  const rawLicense = data.license && typeof data.license === 'object' ? data.license as Record<string, unknown> : {};
  const rawOwner = data.owner && typeof data.owner === 'object' ? data.owner as Record<string, unknown> : undefined;
  const license: OrganizationLicense = {
    planId: rawLicense.planId as OrganizationLicense['planId'],
    status: rawLicense.status as OrganizationLicense['status'],
    seatLimit: typeof rawLicense.seatLimit === 'number' ? rawLicense.seatLimit : undefined,
    trialStartedAt: firestoreDate(rawLicense.trialStartedAt),
    trialEndsAt: firestoreDate(rawLicense.trialEndsAt),
    startsAt: firestoreDate(rawLicense.startsAt),
    expiresAt: firestoreDate(rawLicense.expiresAt),
    graceEndsAt: firestoreDate(rawLicense.graceEndsAt),
    updatedAt: firestoreDate(rawLicense.updatedAt),
    updatedBy: typeof rawLicense.updatedBy === 'string' ? rawLicense.updatedBy : undefined,
  };
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed organization',
    slug: typeof data.slug === 'string' ? data.slug : undefined,
    businessType: typeof data.businessType === 'string' ? data.businessType : undefined,
    currency: typeof data.currency === 'string' ? data.currency : undefined,
    timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
    ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : typeof rawOwner?.email === 'string' ? rawOwner.email : undefined,
    createdAt: firestoreDate(data.createdAt),
    updatedAt: firestoreDate(data.updatedAt),
    license: Object.values(license).some(Boolean) ? license : undefined,
  };
}

export async function fetchOrganizations() {
  const snapshot = await getDocs(collection(firestore, 'organizations'));
  return snapshot.docs.map((item) => organizationFromData(item.id, item.data()));
}

export async function fetchOrganization(orgId: string) {
  const snapshot = await getDoc(doc(firestore, 'organizations', orgId));
  return snapshot.exists() ? organizationFromData(snapshot.id, snapshot.data()) : null;
}

export async function fetchMembers(orgId: string) {
  const snapshot = await getDocs(collection(firestore, 'organizations', orgId, 'members'));
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      userId: typeof data.userId === 'string' ? data.userId : item.id,
      name: typeof data.name === 'string' ? data.name : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      role: data.role === 'ADMIN' || data.role === 'MANAGER' ? data.role : 'USER',
      status: data.status === 'PENDING' || data.status === 'DISABLED' ? data.status : 'ACTIVE',
      joinedAt: firestoreDate(data.joinedAt || data.createdAt),
      lastLogin: firestoreDate(data.lastLogin),
    } as OrganizationMember;
  });
}

export async function fetchMemberCount(orgId: string) {
  const result = await getCountFromServer(collection(firestore, 'organizations', orgId, 'members'));
  return result.data().count;
}
