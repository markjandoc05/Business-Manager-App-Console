'use client';

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './auth-context';

import {
  Customer,
  Installation,
  License,
  InfrastructureMetrics,
  DeploymentRecord,
  ActivityRecord,
  DeveloperUser,
  LicenseStatus,
  HealthStatus,
  Release,
  ActivityAction,
} from './types';

import {
  INITIAL_CUSTOMERS,
  INITIAL_INSTALLATIONS,
  INITIAL_LICENSES,
  INITIAL_INFRASTRUCTURE,
  INITIAL_DEPLOYMENTS,
  INITIAL_ACTIVITIES,
  INITIAL_DEVELOPERS,
  INITIAL_RELEASES,
} from './mock-data';

interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warn';
}

interface ConsoleContextType {
  currentDeveloper: DeveloperUser;
  developers: DeveloperUser[];

  customers: Customer[];
  installations: Installation[];
  licenses: License[];
  infrastructure: InfrastructureMetrics[];
  deployments: DeploymentRecord[];
  releases: Release[];
  activities: ActivityRecord[];

  activeTab: string;
  setActiveTab: (tab: string) => void;

  toasts: ToastNotification[];

  addToast: (
    title: string,
    message: string,
    type?: 'success' | 'error' | 'info' | 'warn'
  ) => void;

  removeToast: (id: string) => void;

  addCustomer: (
    customer: Omit<
      Customer,
      'id' | 'createdAt' | 'installationsCount' | 'totalUsersCount'
    >
  ) => void;

  addInstallation: (
    inst: Omit<
      Installation,
      | 'createdAt'
      | 'lastHeartbeat'
      | 'storageUsedMb'
      | 'activeUsersNow'
      | 'totalLeadsCount'
    >
  ) => void;

  updateLicenseStatus: (
    licenseId: string,
    status: LicenseStatus
  ) => void;

  triggerDeployment: (
    installationId: string,
    targetVersion: string
  ) => void;

  runHealthCheck: (installationId: string) => void;

  updateInstallationHealth: (
    installationId: string,
    health: HealthStatus,
    dbStatus: Installation['dbStatus']
  ) => void;

  addRelease: (release: Omit<Release, 'id'>) => void;
}

const ConsoleContext =
  createContext<ConsoleContextType | undefined>(undefined);

function createActivityTimestamp() {
  return (
    new Date()
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19) + ' UTC'
  );
}

function getLicenseActivityAction(
  status: LicenseStatus
): ActivityAction {
  switch (status) {
    case 'ACTIVE':
      return 'LICENSE_REACTIVATED';

    case 'SUSPENDED':
      return 'LICENSE_SUSPENDED';

    case 'EXPIRING':
    case 'EXPIRED':
    default:
      return 'CONFIGURATION_CHANGED';
  }
}

export function ConsoleProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { developer } = useAuth();
  const currentDeveloper = developer ?? INITIAL_DEVELOPERS[0];

  const [activeTab, setActiveTab] =
    useState<string>('dashboard');

  const [customers, setCustomers] =
    useState<Customer[]>(INITIAL_CUSTOMERS);

  const [installations, setInstallations] =
    useState<Installation[]>(INITIAL_INSTALLATIONS);

  const [licenses, setLicenses] =
    useState<License[]>(INITIAL_LICENSES);

  const [infrastructure, setInfrastructure] =
    useState<InfrastructureMetrics[]>(INITIAL_INFRASTRUCTURE);

  const [deployments, setDeployments] =
    useState<DeploymentRecord[]>(INITIAL_DEPLOYMENTS);

  const [releases, setReleases] =
    useState<Release[]>(INITIAL_RELEASES);

  const [activities, setActivities] =
    useState<ActivityRecord[]>(INITIAL_ACTIVITIES);

  const [toasts, setToasts] =
    useState<ToastNotification[]>([]);

  const addToast = (
    title: string,
    message: string,
    type:
      | 'success'
      | 'error'
      | 'info'
      | 'warn' = 'success'
  ) => {
    const id = Math.random()
      .toString(36)
      .substring(2, 9);

    setToasts((prev) => [
      ...prev,
      {
        id,
        title,
        message,
        type,
      },
    ]);

    setTimeout(() => {
      setToasts((prev) =>
        prev.filter((toast) => toast.id !== id)
      );
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) =>
      prev.filter((toast) => toast.id !== id)
    );
  };

  const addRelease = (
    data: Omit<Release, 'id'>
  ) => {
    const newRelease: Release = {
      ...data,
      id: `REL-${Date.now()}`,
    };

    setReleases((prev) => [
      newRelease,
      ...prev,
    ]);

    addToast(
      'Release Created',
      `Version ${newRelease.version} registered.`,
      'success'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: createActivityTimestamp(),
      action: 'CONFIGURATION_CHANGED',
      type: 'CONFIG',
      severity: 'SUCCESS',
      description: `Registered release ${newRelease.version} with status ${newRelease.releaseStatus}.`,
      actor: currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);
  };

  const addCustomer = (
    data: Omit<
      Customer,
      'id' | 'createdAt' | 'installationsCount' | 'totalUsersCount'
    >
  ) => {
    const newCustomer: Customer = {
      ...data,
      id: `CUST-${Math.floor(
        1000 + Math.random() * 9000
      )}`,
      createdAt: new Date()
        .toISOString()
        .split('T')[0],
      installationsCount: 0,
      totalUsersCount: 0,
    };

    setCustomers((prev) => [
      newCustomer,
      ...prev,
    ]);

    addToast(
      'Customer Created',
      `Successfully added ${newCustomer.name}`,
      'success'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: createActivityTimestamp(),

      // REQUIRED ActivityRecord property
      action: 'CUSTOMER_CREATED',

      type: 'CONFIG',
      severity: 'SUCCESS',
      customerName: newCustomer.name,

      description:
        `Registered new BSM customer organization: ` +
        `${newCustomer.name} (${newCustomer.orgCode})`,

      actor: currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);
  };

  const addInstallation = (
    data: Omit<
      Installation,
      | 'createdAt'
      | 'lastHeartbeat'
      | 'storageUsedMb'
      | 'activeUsersNow'
      | 'totalLeadsCount'
    >
  ) => {
    const newInstallation: Installation = {
      ...data,

      storageUsedMb: 500,
      storageLimitMb: 15000,

      activeUsersNow: 5,
      totalLeadsCount: 120,

      createdAt: new Date()
        .toISOString()
        .split('T')[0],

      lastHeartbeat: 'Just now',
    };

    setInstallations((prev) => [
      newInstallation,
      ...prev,
    ]);

    /*
     * Create initial infrastructure metrics.
     * This is still prototype/mock behavior.
     * Later this will come from actual Cloud Run telemetry.
     */
    const newInfrastructure: InfrastructureMetrics = {
      installationId: newInstallation.id,

      cloudRunStatus: 'Ready',

      cpuAllocation: '2 vCPU',
      memoryMb: 4096,

      minInstances: 1,
      maxInstances: 5,

      firestoreRegion: newInstallation.region,

      storageUsedGb: 0.5,

      activeConnections: 5,

      errorRate5xx: 0,

      averageLatencyMs: 42,

      lastChecked: 'Just now',
    };

    setInfrastructure((prev) => [
      ...prev,
      newInfrastructure,
    ]);

    /*
     * Create default license for installation.
     * Later this will be saved in Firestore.
     */
    const newLicense: License = {
      id: `LIC-${Math.floor(
        1000 + Math.random() * 9000
      )}`,

      installationId: newInstallation.id,

      customerId: newInstallation.customerId,

      status: 'ACTIVE',

      planName: 'Standard Production',

      seatsLimit: 50,
      seatsUsed: 5,

      expiresAt: new Date(
        Date.now() +
          365 * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .split('T')[0],

      licenseKeyMasked:
        `BSM-PROD-${Math.floor(
          1000 + Math.random() * 9000
        )}-XXXX`,

      issuedAt: new Date()
        .toISOString()
        .split('T')[0],

      lastChecked:
        new Date().toISOString(),

      createdAt:
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString(),
    };

    setLicenses((prev) => [
      ...prev,
      newLicense,
    ]);

    /*
     * Update installation count on customer.
     */
    setCustomers((prev) =>
      prev.map((customer) =>
        customer.id ===
        newInstallation.customerId
          ? {
              ...customer,
              installationsCount:
                customer.installationsCount + 1,
            }
          : customer
      )
    );

    addToast(
      'Installation Provisioned',
      `New instance ${newInstallation.id} created successfully.`,
      'success'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,

      timestamp: createActivityTimestamp(),

      // REQUIRED ActivityRecord property
      action: 'INSTALLATION_REGISTERED',

      type: 'CONFIG',

      severity: 'SUCCESS',

      installationId:
        newInstallation.id,

      customerName:
        newInstallation.customerName,

      description:
        `Provisioned BSM installation ` +
        `${newInstallation.id} on Cloud Run ` +
        `(${newInstallation.cloudRunService}) ` +
        `in ${newInstallation.region}.`,

      actor:
        currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);
  };

  const updateLicenseStatus = (
    licenseId: string,
    status: LicenseStatus
  ) => {
    setLicenses((prev) =>
      prev.map((license) =>
        license.id === licenseId
          ? {
              ...license,
              status,
              updatedAt:
                new Date().toISOString(),
              lastChecked:
                new Date().toISOString(),
            }
          : license
      )
    );

    const license = licenses.find(
      (item) => item.id === licenseId
    );

    addToast(
      'License Updated',
      `License ${licenseId} status changed to ${status}`,
      'info'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,

      timestamp:
        createActivityTimestamp(),

      // REQUIRED ActivityRecord property
      action:
        getLicenseActivityAction(status),

      type: 'LICENSE',

      severity:
        status === 'ACTIVE'
          ? 'SUCCESS'
          : status === 'SUSPENDED'
            ? 'WARN'
            : 'INFO',

      installationId:
        license?.installationId,

      description:
        `Updated license ${licenseId} ` +
        `status to ${status}.`,

      actor:
        currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);
  };

  const triggerDeployment = (
    installationId: string,
    targetVersion: string
  ) => {
    /*
     * Mark installation as deploying.
     * Do not mark the target version as completed yet.
     */
    setInstallations((prev) =>
      prev.map((installation) =>
        installation.id === installationId
          ? {
              ...installation,
              deploymentStatus: 'DEPLOYING',
            }
          : installation
      )
    );

    const deployment: DeploymentRecord = {
      id: `DEP-${Math.floor(
        100 + Math.random() * 900
      )}`,

      installationId,

      version: targetVersion,

      targetVersion,

      status: 'DEPLOYING',

      initiatedBy:
        currentDeveloper.name,

      deployedAt:
        createActivityTimestamp(),

      releaseNotes:
        `Manual rolling upgrade initiated ` +
        `via Developer Console to ${targetVersion}.`,
    };

    setDeployments((prev) => [
      deployment,
      ...prev,
    ]);

    addToast(
      'Deployment Triggered',
      `Deploying version ${targetVersion} to ${installationId}`,
      'info'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,

      timestamp:
        createActivityTimestamp(),

      // REQUIRED ActivityRecord property
      action: 'DEPLOYMENT_STARTED',

      type: 'DEPLOYMENT',

      severity: 'INFO',

      installationId,

      description:
        `Initiated deployment of version ` +
        `${targetVersion} for installation ` +
        `${installationId}.`,

      actor:
        currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);

    /*
     * SIMULATION ONLY.
     *
     * Later this should be replaced with
     * actual Cloud Run deployment status.
     */
    setTimeout(() => {
      setInstallations((prev) =>
        prev.map((installation) =>
          installation.id === installationId
            ? {
                ...installation,

                appVersion:
                  targetVersion,

                deploymentStatus:
                  'CURRENT',

                health:
                  'HEALTHY',
              }
            : installation
        )
      );

      setDeployments((prev) =>
        prev.map((item) =>
          item.id === deployment.id
            ? {
                ...item,
                status: 'CURRENT',
              }
            : item
        )
      );

      addToast(
        'Deployment Successful',
        `Installation ${installationId} is now running ${targetVersion}`,
        'success'
      );

      const completedActivity: ActivityRecord = {
        id: `act-${Date.now()}`,

        timestamp:
          createActivityTimestamp(),

        action:
          'DEPLOYMENT_COMPLETED',

        type:
          'DEPLOYMENT',

        severity:
          'SUCCESS',

        installationId,

        description:
          `Deployment completed successfully. ` +
          `${installationId} is now running ` +
          `${targetVersion}.`,

        actor:
          currentDeveloper.name,
      };

      setActivities((prev) => [
        completedActivity,
        ...prev,
      ]);
    }, 3500);
  };

  const runHealthCheck = (
    installationId: string
  ) => {
    addToast(
      'Health Probe Sent',
      `Pinging heartbeats & Cloud Run health endpoint for ${installationId}...`,
      'info'
    );

    /*
     * SIMULATION ONLY.
     *
     * Later this will call the actual
     * installation heartbeat / health API.
     */
    setTimeout(() => {
      addToast(
        'Health Verified',
        `Installation ${installationId} responded successfully (Latency: 38ms).`,
        'success'
      );

      setInstallations((prev) =>
        prev.map((installation) =>
          installation.id === installationId
            ? {
                ...installation,

                lastHeartbeat:
                  'Just now',

                health:
                  installation.health ===
                  'CRITICAL'
                    ? 'ATTENTION'
                    : installation.health,
              }
            : installation
        )
      );
    }, 1500);
  };

  const updateInstallationHealth = (
    installationId: string,
    health: HealthStatus,
    dbStatus: Installation['dbStatus']
  ) => {
    setInstallations((prev) =>
      prev.map((installation) =>
        installation.id === installationId
          ? {
              ...installation,
              health,
              dbStatus,
            }
          : installation
      )
    );

    addToast(
      'Health State Updated',
      `Set ${installationId} health to ${health}`,
      'warn'
    );

    const activity: ActivityRecord = {
      id: `act-${Date.now()}`,

      timestamp:
        createActivityTimestamp(),

      // REQUIRED ActivityRecord property
      action:
        'INFRASTRUCTURE_WARNING',

      type:
        'HEALTH',

      severity:
        health === 'HEALTHY'
          ? 'SUCCESS'
          : health === 'CRITICAL'
            ? 'ERROR'
            : 'WARN',

      installationId,

      description:
        `Manual status override: ` +
        `Installation health set to ${health} ` +
        `(DB: ${dbStatus}).`,

      actor:
        currentDeveloper.name,
    };

    setActivities((prev) => [
      activity,
      ...prev,
    ]);
  };

  return (
    <ConsoleContext.Provider
      value={{
        currentDeveloper,
        developers: developer ? [developer] : [],

        customers,

        installations,

        licenses,

        infrastructure,

        deployments,

        releases,

        activities,

        activeTab,
        setActiveTab,

        toasts,
        addToast,
        removeToast,

        addCustomer,
        addInstallation,

        updateLicenseStatus,

        triggerDeployment,

        runHealthCheck,

        updateInstallationHealth,

        addRelease,
      }}
    >
      {children}
    </ConsoleContext.Provider>
  );
}

export function useConsole() {
  const context =
    useContext(ConsoleContext);

  if (!context) {
    throw new Error(
      'useConsole must be used within a ConsoleProvider'
    );
  }

  return context;
}
