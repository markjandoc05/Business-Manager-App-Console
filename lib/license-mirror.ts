import type { Firestore } from 'firebase-admin/firestore';
import { buildOrganizationLicenseMirror, compareOrganizationLicenseMirror, parseCanonicalLicense } from './license-contract.ts';

export async function loadLicenseMirrorState({ firestore, organizationId }: { firestore: Firestore; organizationId: string }) {
  const organizationRef = firestore.collection('organizations').doc(organizationId);
  const canonicalRef = organizationRef.collection('license').doc('current');
  const [organization, canonical] = await Promise.all([organizationRef.get(), canonicalRef.get()]);
  if (!canonical.exists) return { organizationRef, canonicalRef, organization, canonical, parsedCanonicalLicense: null, derivedMirror: null, differences: [], status: 'MISSING_CANONICAL_DOCUMENT' as const };
  const parsedCanonicalLicense = parseCanonicalLicense(canonical.data() || {});
  if (!parsedCanonicalLicense) return { organizationRef, canonicalRef, organization, canonical, parsedCanonicalLicense: null, derivedMirror: null, differences: [], status: 'INVALID_CANONICAL_LICENSE' as const };
  const derivedMirror = buildOrganizationLicenseMirror(parsedCanonicalLicense);
  const comparison = compareOrganizationLicenseMirror(parsedCanonicalLicense, organization.data() || {});
  return { organizationRef, canonicalRef, organization, canonical, parsedCanonicalLicense, derivedMirror, differences: comparison.differences, status: comparison.status };
}
