export type PlatformAdminRole = 'SUPER_ADMIN' | 'SUPPORT';
export type PlatformAdminStatus = 'ACTIVE' | 'DISABLED';

export interface PlatformAdmin {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
  status: PlatformAdminStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type OrganizationLicenseStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
export type OrganizationSubscriptionStatus = 'trialing' | 'active' | 'expired' | 'cancelled';

export interface ConsoleSubscriptionPlanUsage {
  planId: string;
  eligibleCustomerCount: number;
  limit: number | null;
  remaining: number | null;
  isFull: boolean;
  source: 'counter';
  updatedAt?: string;
}

export interface ConsoleSubscriptionPlanMarketing {
  badge?: string;
  messages: string[];
}

export interface ConsoleSubscriptionPlan {
  planId: string;
  code: string;
  /** Read-only platform mapping; never a Client App authorization input. */
  entitlementTier: Exclude<OrganizationPlan, 'TRIAL'>;
  displayName: string;
  price: number;
  currency: string;
  billingInterval: 'year';
  trialDays: number;
  noCreditCardRequired: boolean;
  /** Server-owned capacity for the Founding commercial offer; null otherwise. */
  foundingLimit: number | null;
  maxEligibleCustomers: number | null;
  publicSignup: boolean;
  marketing?: ConsoleSubscriptionPlanMarketing;
  marketingUpdatedAt?: string;
  marketingUpdatedByUid?: string;
  marketingRevision: number;
  autoRolloverEnabled: boolean;
  autoRolloverPlanId: string | null;
  source: 'persisted' | 'default';
  usage: ConsoleSubscriptionPlanUsage;
}

/** Platform-only projection used by the Subscription / License Operations screen. */
export interface SubscriptionOperationLicense {
  organizationId: string;
  organizationName: string;
  planId: string | null;
  planName: string | null;
  entitlementTier: Exclude<OrganizationPlan, 'TRIAL'> | null;
  canonicalPlan: OrganizationPlan | null;
  status: LicenseAdminStatus;
  canonicalStatus: OrganizationLicenseStatus | null;
  documentState: LicenseDocumentState;
  trialEndsAt?: string;
  subscriptionStartedAt?: string;
  subscriptionEndsAt?: string;
  renewalDate?: string;
  priceAtSubscription: number | null;
  currency?: string;
  billingInterval?: string;
  activeSeatCount: number;
  maxUsers: number | null;
  allowedActions: LicenseAdminAction[];
}

export interface SubscriptionOperationsOverview {
  founding100: {
    limit: number;
    remainingCapacity: number;
    usageExceedsLimit: boolean;
    publicSignup: boolean;
    canonicalEligibleCustomerCount: number;
    storedEligibleCustomerCount: number;
    difference: number;
    matches: boolean;
  };
  standardSubscriptionCount: number;
  trialCount: number;
  activeCount: number;
  expiredCount: number;
  suspendedCount: number;
  upcomingRenewals: SubscriptionOperationLicense[];
}

export interface SubscriptionOperationsData {
  overview: SubscriptionOperationsOverview;
  licenses: SubscriptionOperationLicense[];
}

export type SubscriptionLicenseStatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE' | 'NEEDS_ATTENTION';
export type SubscriptionRenewalFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_30' | 'WITHIN_90' | 'OVERDUE' | 'NO_DATE';
export type SubscriptionTrialFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_14' | 'EXPIRED' | 'NO_TRIAL';

/** Allowlisted server-side filters for the paginated Console license table. */
export interface SubscriptionOperationLicenseFilters {
  query?: string;
  plan?: string;
  status?: SubscriptionLicenseStatusFilter;
  renewalPeriod?: SubscriptionRenewalFilter;
  trialExpiration?: SubscriptionTrialFilter;
}

export interface SubscriptionOperationLicensePage {
  licenses: SubscriptionOperationLicense[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SubscriptionAuditHistoryItem {
  id: string;
  action: string;
  actorRole?: string;
  createdAt?: string;
  planId?: string;
  priceAtSubscription?: number;
  currency?: string;
  billingInterval?: string;
  provisioning?: boolean;
}

export interface SubscriptionLicenseDetail {
  license: SubscriptionOperationLicense;
  plan: Pick<ConsoleSubscriptionPlan, 'planId' | 'code' | 'entitlementTier' | 'displayName' | 'price' | 'currency' | 'billingInterval' | 'trialDays' | 'noCreditCardRequired' | 'foundingLimit' | 'maxEligibleCustomers' | 'publicSignup'> | null;
  auditHistory: SubscriptionAuditHistoryItem[];
}
export type LicenseDocumentState = 'NO_LICENSE' | 'INVALID_LICENSE' | 'VALID_LICENSE';
export type LicenseAdminStatus = OrganizationLicenseStatus | 'UNKNOWN';
export type LicenseAdminAction =
  | 'ACTIVATE'
  | 'REPAIR_LICENSE'
  | 'EDIT_LICENSE_DETAILS'
  | 'EXTEND_TRIAL'
  | 'CONVERT_TO_PAID'
  | 'EXTEND_SUBSCRIPTION'
  | 'RENEW'
  | 'CHANGE_PLAN'
  | 'CHANGE_SEAT_LIMIT'
  | 'SUSPEND'
  | 'EXPIRE'
  | 'REACTIVATE';

export interface LicenseActionPayload {
  plan?: OrganizationPlan;
  maxUsers?: number;
  trialStartedAt?: string;
  subscriptionStartedAt?: string;
  subscriptionEndsAt?: string;
  trialEndsAt?: string;
  reason?: string;
}

export type OrganizationPlan = 'TRIAL' | 'SOLO' | 'STARTER' | 'TEAM' | 'LEGACY';

export type OrganizationUsageStatus = 'NO_LIMIT' | 'NORMAL' | 'WARNING' | 'HIGH' | 'FULL' | 'UNAVAILABLE';

export interface OrganizationUsageBreakdown {
  leads: number;
  clients: number;
  deals: number;
  tasks: number;
  activities: number;
  members: number;
  files: number;
}

export interface OrganizationUsage {
  usageAvailable: boolean;
  storageAvailable: boolean;
  usageCoverage: 'PARTIAL' | 'UNKNOWN';
  usageNotes: string[];
  storageBytes: number;
  firestoreBytesEstimated: number;
  totalBytesEstimated: number;
  fileCount: number;
  recordCount: number;
  breakdown: OrganizationUsageBreakdown;
  storageLimitBytes: number | null;
  usagePercent: number | null;
  usageStatus: OrganizationUsageStatus;
  lastCalculatedAt?: string;
  lastReconciledAt?: string;
}

export interface OrganizationLicense {
  organizationId?: string;
  planId?: string;
  entitlementTier?: Exclude<OrganizationPlan, 'TRIAL'>;
  plan?: OrganizationPlan;
  status?: OrganizationLicenseStatus;
  canonicalStatus?: OrganizationLicenseStatus;
  subscriptionStatus?: OrganizationSubscriptionStatus;
  maxUsers?: number;
  features?: Record<string, boolean>;
  trialStartedAt?: string;
  trialEndsAt?: string;
  subscriptionStartedAt?: string;
  renewalDate?: string;
  subscriptionEndsAt?: string;
  priceAtSubscription?: number | null;
  currency?: string;
  billingInterval?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  businessType?: string;
  status?: 'trial' | 'active' | 'expired' | 'suspended';
  plan?: string;
  planId?: string;
  subscriptionStatus?: string;
  maxUsers?: number;
  licenseStatus?: OrganizationLicenseStatus;
  licenseWriteEnabled?: boolean;
  licenseExpiresAt?: string;
  currency?: string;
  timezone?: string;
  localeSettings?: {
    timezone: string | null;
    currency: string | null;
    timezoneSource: string;
    currencySource: string;
  };
  /** Allowlisted organization-root metadata only; never customer records. */
  platformMetadata?: OrganizationPlatformMetadata;
  ownerEmail?: string;
  createdAt?: string;
  updatedAt?: string;
  license?: OrganizationLicense;
  licenseDocumentState?: LicenseDocumentState;
  licenseAdminState?: LicenseAdminState;
  organizationAdminState?: OrganizationAdminState;
  activeMemberCount?: number;
}

export type OrganizationMemberRole = 'ADMIN' | 'MANAGER' | 'USER';
export type OrganizationMemberStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'DISABLED';
export type OrganizationMemberLoginStatus = 'SUCCESS' | 'FAILED';

export type OrganizationAttentionReason =
  | 'NO_LICENSE'
  | 'INVALID_LICENSE'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_EXPIRING_SOON'
  | 'TRIAL_EXPIRING_SOON'
  | 'LICENSE_SUSPENDED'
  | 'SEAT_LIMIT_EXCEEDED'
  | 'MISSING_REQUIRED_ORGANIZATION_DATA'
  | 'MISSING_TIMEZONE'
  | 'MISSING_CURRENCY'
  | 'STORAGE_USAGE_WARNING'
  | 'STORAGE_USAGE_HIGH'
  | 'STORAGE_LIMIT_REACHED';

export interface OrganizationAdminState {
  health: 'HEALTHY' | 'ACTION_REQUIRED' | 'WARNING';
  attentionReasons: OrganizationAttentionReason[];
}

/** Allowlisted organization-root metadata; never tenant business data. */
export interface OrganizationPlatformMetadata {
  workspaceSlug?: string;
}

/** Platform-safe record used by the Customers & Organizations registry. */
export interface OrganizationRegistryEntry {
  organizationId: string;
  organizationName: string;
  platformStatus: OrganizationAdminState['health'];
  createdAt?: string;
  planId: string | null;
  planName: string | null;
  canonicalPlan: OrganizationPlan | null;
  licenseStatus: LicenseAdminStatus;
  canonicalLicenseStatus: OrganizationLicenseStatus | null;
  licenseDocumentState: LicenseDocumentState;
  trialEndsAt?: string;
  subscriptionStartedAt?: string;
  renewalDate?: string;
  subscriptionEndsAt?: string;
  priceAtSubscription: number | null;
  currency?: string;
  billingInterval?: string;
  activeSeatCount: number;
  maxUsers: number | null;
  platformMetadata: OrganizationPlatformMetadata;
}

/** Allowlisted filters for the cursor-paged Customers & Organizations registry. */
export type OrganizationRegistryLicenseStatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE' | 'NEEDS_ATTENTION';
export type OrganizationRegistryPlatformStatusFilter = 'ALL' | 'HEALTHY' | 'WARNING' | 'ACTION_REQUIRED';
export type OrganizationRegistryCreationDateFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_30' | 'WITHIN_90' | 'OLDER_THAN_90' | 'UNKNOWN';
export type OrganizationRegistryLifecycleFilter = 'ALL' | 'TRIAL_ENDS_7' | 'TRIAL_ENDED' | 'RENEWS_30' | 'RENEWAL_OVERDUE' | 'NO_RENEWAL_OR_TRIAL_DATE';

export interface OrganizationRegistryFilters {
  query?: string;
  plan?: string;
  licenseStatus?: OrganizationRegistryLicenseStatusFilter;
  platformStatus?: OrganizationRegistryPlatformStatusFilter;
  creationDate?: OrganizationRegistryCreationDateFilter;
  lifecycle?: OrganizationRegistryLifecycleFilter;
}

/** Small, authoritative plan labels used only by the registry filter control. */
export interface OrganizationRegistryPlanOption {
  planId: string;
  displayName: string;
}

/** A bounded organization page; the browser never receives the whole registry. */
export interface OrganizationRegistryPage {
  items: OrganizationRegistryEntry[];
  planOptions: OrganizationRegistryPlanOption[];
  nextCursor?: string;
  hasMore: boolean;
}

/** A deliberately redacted audit item for a single organization detail view. */
export interface OrganizationPlatformAuditItem {
  id: string;
  action: string;
  actorRole?: PlatformAdminRole | 'ORGANIZATION_ADMIN';
  createdAt?: string;
}

export interface OrganizationOperationsDetail {
  organization: OrganizationRegistryEntry;
  auditHistory: OrganizationPlatformAuditItem[];
}

/** Platform-safe audit projection. It deliberately excludes identities and raw values. */
export type PlatformAuditActorRole = PlatformAdminRole | 'ORGANIZATION_ADMIN' | 'SYSTEM';
export type PlatformAuditResult = 'SUCCESS' | 'FAILED' | 'DENIED';

export interface PlatformAuditLogItem {
  id: string;
  action: string;
  actorRole: PlatformAuditActorRole;
  targetType: string;
  targetId?: string;
  organizationId?: string;
  /** Allowlisted organization-root display name for the current audit page. */
  organizationName?: string;
  result?: PlatformAuditResult;
  details: string[];
  createdAt?: string;
}

export interface PlatformAuditLogFilters {
  dateFrom?: string;
  dateTo?: string;
  action?: string;
  organizationId?: string;
  actorRole?: PlatformAuditActorRole;
  targetType?: string;
}

export interface PlatformAuditLogPage {
  items: PlatformAuditLogItem[];
  nextCursor?: string;
  pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; nextCursor?: string };
}

export interface DashboardAttentionItem {
  organizationId: string;
  organizationName: string;
  reason: OrganizationAttentionReason;
  reasonLabel: string;
  priority: number;
  status: LicenseAdminStatus;
  plan: OrganizationPlan | null;
  activeMemberCount: number;
  maxUsers: number | null;
  daysRemaining: number | null;
  expiresAt: string | null;
  allowedActions: LicenseAdminAction[];
  primaryAction?: LicenseAdminAction;
  usagePercent?: number | null;
  usageStatus?: OrganizationUsageStatus;
}

export interface DashboardUpcomingLicenseAction {
  organizationId: string;
  organizationName: string;
  plan: OrganizationPlan | null;
  status: LicenseAdminStatus;
  expiresAt: string | null;
  daysRemaining: number | null;
  action: LicenseAdminAction;
  allowedActions: LicenseAdminAction[];
}

export interface DashboardSeatUtilizationItem {
  organizationId: string;
  organizationName: string;
  activeMemberCount: number;
  maxUsers: number | null;
  availableSeats: number | null;
  utilizationPercent: number | null;
  state: 'NEAR_LIMIT' | 'FULL' | 'OVER_LIMIT' | 'UNLICENSED';
}

export interface DashboardActivityItem {
  id: string;
  action?: string;
  title: string;
  actorName: string;
  organizationId?: string;
  organizationName?: string;
  detail?: string;
  createdAt?: string;
}

export interface DashboardMetrics {
  summary: {
    organizationsTotal: number;
    organizationsActive: number;
    organizationsTrial: number;
    organizationsAttention: number;
    activeMembers: number;
    licensesExpiringSoon: number;
    licensesExpired: number;
    licensesSuspended: number;
  };
  attentionSummary: {
    invalidLicense: number;
    noLicense: number;
    expired: number;
    seatLimitExceeded: number;
    expiringSoon: number;
    suspended: number;
    missingSetup: number;
    storageWarning: number;
    storageHigh: number;
    storageLimitReached: number;
  };
  attention: DashboardAttentionItem[];
  licensingOverview: { active: number; trial: number; expired: number; suspended: number; invalid: number; noLicense: number };
  planDistribution: Record<OrganizationPlan, number>;
  upcomingLicenseActions: DashboardUpcomingLicenseAction[];
  seatUtilization: DashboardSeatUtilizationItem[];
  recentActivity: DashboardActivityItem[];
}

/** Read-only, platform-wide operational health. No tenant business data is included. */
export type PlatformHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export interface PlatformHealthCheck {
  id: 'CONSOLE_BACKEND' | 'FIRESTORE' | 'FIREBASE_ADMIN_AUTH' | 'SUBSCRIPTION_LICENSE_SERVICE' | 'PLAN_CATALOG' | 'LICENSE_MIRRORS';
  label: string;
  status: PlatformHealthStatus;
  detail: string;
}

export interface PlatformHealthWarning {
  code: 'FOUNDING_100_USAGE_MISMATCH' | 'FOUNDING_CAPACITY_EXCEEDED' | 'PLATFORM_PLAN_MISSING' | 'PLATFORM_PLAN_INVALID' | 'CANONICAL_LICENSE_MALFORMED' | 'CANONICAL_LICENSE_MISSING' | 'ORGANIZATION_LICENSE_MIRROR_INCONSISTENT';
  title: string;
  detail: string;
  count?: number;
}

export interface PlatformHealthData {
  status: PlatformHealthStatus;
  checkedAt: string;
  checks: PlatformHealthCheck[];
  warnings: PlatformHealthWarning[];
  foundingCapacity: {
    configuredLimit: number;
    canonicalEligibleCustomerCount: number;
    remainingCapacity: number;
    storedEligibleCustomerCount: number;
    difference: number;
    matches: boolean;
    usageExceedsLimit: boolean;
  } | null;
  summary: {
    totalOrganizations: number | null;
    activeLicenses: number | null;
    trialLicenses: number | null;
    expiredLicenses: number | null;
    suspendedLicenses: number | null;
  };
}

export interface OrganizationMember {
  id: string;
  userId?: string;
  name?: string;
  email?: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  joinedAt?: string;
  lastLogin?: string;
  lastLoginAt?: string;
  lastLoginStatus?: OrganizationMemberLoginStatus;
  lastSuccessfulLoginAt?: string;
  lastFailedLoginAt?: string;
  lastLoginFailureCode?: string;
}

/** Safe membership read model. Emails are limited to this authorized platform-operations screen. */
export interface ConsoleMembership extends OrganizationMember {
  organization: string;
  organizationId: string;
  licenseStatus: string;
  organizationHealth?: OrganizationAdminState['health'];
  attentionReasons?: OrganizationAttentionReason[];
  activeMemberCount?: number;
  maxUsers?: number | null;
}

export interface OrganizationMembershipFilters {
  query?: string;
  status?: OrganizationMemberStatus | 'ALL';
}

/** Membership is intentionally scoped to one organization and cursor-paged. */
export interface OrganizationMembershipPage {
  organization: OrganizationRegistryEntry;
  members: ConsoleMembership[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface PlatformAdminListEntry {
  uid: string;
  email?: string;
  displayName?: string;
  role?: PlatformAdminRole;
  status?: PlatformAdminStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlatformAdminPage {
  items: PlatformAdminListEntry[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface LicenseAdminState {
  documentState: LicenseDocumentState;
  status: LicenseAdminStatus;
  plan: OrganizationPlan | null;
  activeMembers: number;
  maxUsers: number | null;
  daysRemaining: number | null;
  expiresAt: string | null;
  allowedActions: LicenseAdminAction[];
}
