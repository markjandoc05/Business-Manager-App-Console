export type HealthStatus = 'HEALTHY' | 'ATTENTION' | 'OFFLINE' | 'CRITICAL' | 'UNKNOWN';

export type LicenseStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED';

export type DeploymentStatus = 'CURRENT' | 'UPDATE_AVAILABLE' | 'DEPLOYING' | 'FAILED' | 'ROLLBACK_AVAILABLE';

export type DeveloperRole = 'OWNER' | 'DEVELOPER' | 'SUPPORT';

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

export type OrganizationUsageStatus = 'NO_LIMIT' | 'NORMAL' | 'WARNING' | 'HIGH' | 'FULL';

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
  plan?: OrganizationPlan;
  status?: OrganizationLicenseStatus;
  maxUsers?: number;
  features?: Record<string, boolean>;
  trialStartedAt?: string;
  trialEndsAt?: string;
  subscriptionStartedAt?: string;
  subscriptionEndsAt?: string;
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
  actorEmail?: string;
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

export interface DeveloperUser {
  id: string;
  name: string;
  email: string;
  role: DeveloperRole;
  avatar: string;
  lastLogin: string;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  orgCode: string;
  type: 'Corporate' | 'SMB' | 'Enterprise';
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'INACTIVE';
  plan: 'Enterprise' | 'Business' | 'Growth' | 'Trial';
  primaryContactEmail: string;
  phone: string;
  website: string;
  address: string;
  country: string;
  internalNotes: string;
  createdAt: string;
  installationsCount: number;
  totalUsersCount: number;
}

export interface Installation {
  id: string; // e.g. BSM-0001-001
  name: string;
  customerId: string;
  customerName: string;
  domain: string;
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  region: string;
  cloudProject: string;
  firebaseProject: string;
  cloudRunService: string;
  dbStatus: 'Connected' | 'High Latency' | 'Degraded' | 'Disconnected';
  storageUsedMb: number;
  storageLimitMb: number;
  appVersion: string;
  revision?: string; // Optional for now
  deploymentStatus: DeploymentStatus;
  health: HealthStatus;
  licenseId: string;
  lastHeartbeat: string;
  createdAt: string;
  activeUsersNow: number;
  totalLeadsCount: number;
}

export interface License {
  id: string;
  installationId: string;
  customerId: string;
  status: LicenseStatus;
  planName: string;
  seatsLimit: number;
  seatsUsed: number;
  issuedAt: string;
  expiresAt: string;
  licenseKeyMasked: string;
  lastChecked: string;
  createdAt: string;
  updatedAt: string;
}

export interface Release {
  id: string;
  version: string;
  releaseDate: string;
  releaseStatus: 'DRAFT' | 'STABLE' | 'DEPRECATED';
  notes: string;
}

export interface InfrastructureMetrics {
  installationId: string;
  cloudRunStatus: 'Ready' | 'Scaling' | 'Error' | 'Updating';
  cpuAllocation: string; // e.g. "1 vCPU"
  memoryMb: number;
  minInstances: number;
  maxInstances: number;
  firestoreRegion: string;
  storageUsedGb: number;
  activeConnections: number;
  errorRate5xx: number; // percentage
  averageLatencyMs: number;
  lastChecked: string;
}

export interface DeploymentRecord {
  id: string;
  installationId: string;
  version: string;
  targetVersion: string;
  status: DeploymentStatus;
  initiatedBy: string;
  deployedAt: string;
  releaseNotes: string;
}

export type ActivityAction =
  | 'CUSTOMER_CREATED' | 'CUSTOMER_UPDATED'
  | 'INSTALLATION_REGISTERED' | 'INSTALLATION_UPDATED'
  | 'LICENSE_CREATED' | 'LICENSE_ACTIVATED' | 'LICENSE_RENEWED' | 'LICENSE_SUSPENDED' | 'LICENSE_REACTIVATED'
  | 'DOMAIN_UPDATED'
  | 'DEPLOYMENT_STARTED' | 'DEPLOYMENT_COMPLETED' | 'DEPLOYMENT_FAILED' | 'ROLLBACK'
  | 'INFRASTRUCTURE_WARNING'
  | 'CONFIGURATION_CHANGED';

export interface ActivityRecord {
  id: string;
  timestamp: string;
  action: ActivityAction;
  type: 'DEPLOYMENT' | 'LICENSE' | 'HEALTH' | 'INFRA' | 'SECURITY' | 'CONFIG';
  severity: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  installationId?: string;
  customerName?: string;
  description: string;
  actor: string;
  metadata?: Record<string, any>;
}
