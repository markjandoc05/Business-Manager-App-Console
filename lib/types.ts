export type HealthStatus = 'HEALTHY' | 'ATTENTION' | 'OFFLINE' | 'CRITICAL' | 'UNKNOWN';

export type LicenseStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED';

export type DeploymentStatus = 'CURRENT' | 'UPDATE_AVAILABLE' | 'DEPLOYING' | 'FAILED' | 'ROLLBACK_AVAILABLE';

export type DeveloperRole = 'OWNER' | 'DEVELOPER' | 'SUPPORT';

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
