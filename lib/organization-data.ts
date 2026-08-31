import { collection, doc, getCountFromServer, getDoc, getDocs } from 'firebase/firestore';
import { firestore } from './firebase';
import { parseCanonicalLicense } from './license-contract';
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

export function organizationFromData(id: string, data: Record<string, unknown>, canonicalLicense?: Record<string, unknown>): Organization {
  const rawOwner = data.owner && typeof data.owner === 'object' ? data.owner as Record<string, unknown> : undefined;
  const parsedLicense = canonicalLicense ? parseCanonicalLicense(canonicalLicense) : null;
  const license: OrganizationLicense | undefined = parsedLicense ? {
    plan: parsedLicense.plan,
    status: parsedLicense.status,
    maxUsers: parsedLicense.maxUsers,
    features: parsedLicense.features,
    trialStartedAt: firestoreDate(parsedLicense.trialStartedAt),
    trialEndsAt: firestoreDate(parsedLicense.trialEndsAt),
    subscriptionStartedAt: firestoreDate(parsedLicense.subscriptionStartedAt),
    subscriptionEndsAt: firestoreDate(parsedLicense.subscriptionEndsAt),
    createdAt: firestoreDate(parsedLicense.createdAt),
    updatedAt: firestoreDate(parsedLicense.updatedAt),
    updatedBy: parsedLicense.updatedBy,
  } : undefined;
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed organization',
    slug: typeof data.slug === 'string' ? data.slug : undefined,
    businessType: typeof data.businessType === 'string' ? data.businessType : undefined,
    status: data.status === 'trial' || data.status === 'active' || data.status === 'expired' || data.status === 'suspended' ? data.status : undefined,
    plan: typeof data.plan === 'string' ? data.plan : undefined,
    subscriptionStatus: typeof data.subscriptionStatus === 'string' ? data.subscriptionStatus : undefined,
    maxUsers: typeof data.maxUsers === 'number' ? data.maxUsers : undefined,
    licenseStatus: data.licenseStatus === 'TRIAL' || data.licenseStatus === 'ACTIVE' || data.licenseStatus === 'EXPIRED' || data.licenseStatus === 'SUSPENDED' ? data.licenseStatus : undefined,
    licenseWriteEnabled: typeof data.licenseWriteEnabled === 'boolean' ? data.licenseWriteEnabled : undefined,
    licenseExpiresAt: firestoreDate(data.licenseExpiresAt),
    currency: typeof data.currency === 'string' ? data.currency : undefined,
    timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
    ownerEmail: typeof data.ownerEmail === 'string' ? data.ownerEmail : typeof rawOwner?.email === 'string' ? rawOwner.email : undefined,
    createdAt: firestoreDate(data.createdAt),
    updatedAt: firestoreDate(data.updatedAt),
    license,
  };
}

async function fetchCanonicalLicense(orgId: string) {
  const snapshot = await getDoc(doc(firestore, 'organizations', orgId, 'license', 'current'));
  return snapshot.exists() ? snapshot.data() : undefined;
}

export async function fetchOrganizations() {
  const snapshot = await getDocs(collection(firestore, 'organizations'));
  return Promise.all(snapshot.docs.map(async (item) => organizationFromData(item.id, item.data(), await fetchCanonicalLicense(item.id))));
}

export async function fetchOrganization(orgId: string) {
  const snapshot = await getDoc(doc(firestore, 'organizations', orgId));
  return snapshot.exists() ? organizationFromData(snapshot.id, snapshot.data(), await fetchCanonicalLicense(orgId)) : null;
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
      lastLoginAt: firestoreDate(data.lastLoginAt || data.lastLogin),
      lastLoginStatus: data.lastLoginStatus === 'SUCCESS' || data.lastLoginStatus === 'FAILED' ? data.lastLoginStatus : undefined,
      lastSuccessfulLoginAt: firestoreDate(data.lastSuccessfulLoginAt),
      lastFailedLoginAt: firestoreDate(data.lastFailedLoginAt),
      lastLoginFailureCode: typeof data.lastLoginFailureCode === 'string' ? data.lastLoginFailureCode : undefined,
    } as OrganizationMember;
  });
}

export async function fetchMemberCount(orgId: string) {
  const result = await getCountFromServer(collection(firestore, 'organizations', orgId, 'members'));
  return result.data().count;
}
