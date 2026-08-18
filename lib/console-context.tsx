'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  DeploymentStatus,
  Release,
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
  setCurrentDeveloper: (dev: DeveloperUser) => void;
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
  addToast: (title: string, message: string, type?: 'success' | 'error' | 'info' | 'warn') => void;
  removeToast: (id: string) => void;

  // Actions
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt' | 'installationsCount' | 'totalUsersCount'>) => void;
  addInstallation: (inst: Omit<Installation, 'createdAt' | 'lastHeartbeat' | 'storageUsedMb' | 'activeUsersNow' | 'totalLeadsCount'>) => void;
  updateLicenseStatus: (licenseId: string, status: LicenseStatus) => void;
  triggerDeployment: (installationId: string, targetVersion: string) => void;
  runHealthCheck: (installationId: string) => void;
  updateInstallationHealth: (installationId: string, health: HealthStatus, dbStatus: Installation['dbStatus']) => void;
  addRelease: (release: Omit<Release, 'id'>) => void;
}

const ConsoleContext = createContext<ConsoleContextType | undefined>(undefined);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [currentDeveloper, setCurrentDeveloper] = useState<DeveloperUser>(INITIAL_DEVELOPERS[0]);
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [installations, setInstallations] = useState<Installation[]>(INITIAL_INSTALLATIONS);
  const [licenses, setLicenses] = useState<License[]>(INITIAL_LICENSES);
  const [infrastructure, setInfrastructure] = useState<InfrastructureMetrics[]>(INITIAL_INFRASTRUCTURE);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>(INITIAL_DEPLOYMENTS);
  const [releases, setReleases] = useState<Release[]>(INITIAL_RELEASES);
  const [activities, setActivities] = useState<ActivityRecord[]>(INITIAL_ACTIVITIES);

  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const addToast = (title: string, message: string, type: 'success' | 'error' | 'info' | 'warn' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const addRelease = (data: Omit<Release, 'id'>) => {
    const newRel: Release = {
      ...data,
      id: `REL-${Date.now()}`,
    };
    setReleases((prev) => [newRel, ...prev]);
    addToast('Release Created', `Version ${newRel.version} registered.`, 'success');
  };

  const addCustomer = (data: Omit<Customer, 'id' | 'createdAt' | 'installationsCount' | 'totalUsersCount'>) => {
    const newCust: Customer = {
      ...data,
      id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      createdAt: new Date().toISOString().split('T')[0],
      installationsCount: 0,
      totalUsersCount: 0,
    };
    setCustomers((prev) => [newCust, ...prev]);
    addToast('Customer Created', `Successfully added ${newCust.name}`, 'success');

    // Log activity
    const newAct: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      type: 'CONFIG',
      severity: 'SUCCESS',
      customerName: newCust.name,
      description: `Registered new BSM customer organization: ${newCust.name} (${newCust.orgCode})`,
      actor: currentDeveloper.name,
    };
    setActivities((prev) => [newAct, ...prev]);
  };

  const addInstallation = (data: Omit<Installation, 'createdAt' | 'lastHeartbeat' | 'storageUsedMb' | 'activeUsersNow' | 'totalLeadsCount'>) => {
    const newInst: Installation = {
      ...data,
      storageUsedMb: 500,
      storageLimitMb: 15000,
      activeUsersNow: 5,
      totalLeadsCount: 120,
      createdAt: new Date().toISOString().split('T')[0],
      lastHeartbeat: 'Just now',
    };

    setInstallations((prev) => [newInst, ...prev]);

    // Add infra metrics
    const newInfra: InfrastructureMetrics = {
      installationId: newInst.id,
      cloudRunStatus: 'Ready',
      cpuAllocation: '2 vCPU',
      memoryMb: 4096,
      minInstances: 1,
      maxInstances: 5,
      firestoreRegion: newInst.region,
      storageUsedGb: 0.5,
      activeConnections: 5,
      errorRate5xx: 0.0,
      averageLatencyMs: 42,
      lastChecked: 'Just now',
    };
    setInfrastructure((prev) => [...prev, newInfra]);

    // Add default license
    const newLic: License = {
      id: `LIC-${Math.floor(1000 + Math.random() * 9000)}`,
      installationId: newInst.id,
      customerId: newInst.customerId,
      status: 'ACTIVE',
      planName: 'Standard Production',
      seatsLimit: 50,
      seatsUsed: 5,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      licenseKeyMasked: `BSM-PROD-${Math.floor(1000 + Math.random() * 9000)}-XXXX`,
      issuedAt: new Date().toISOString().split('T')[0],
      lastChecked: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLicenses((prev) => [...prev, newLic]);

    // Update customer count
    setCustomers((prev) =>
      prev.map((c) => (c.id === newInst.customerId ? { ...c, installationsCount: c.installationsCount + 1 } : c))
    );

    addToast('Installation Provisioned', `New instance ${newInst.id} created successfully.`, 'success');

    const act: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      type: 'CONFIG',
      severity: 'SUCCESS',
      installationId: newInst.id,
      customerName: newInst.customerName,
      description: `Provisioned BSM installation ${newInst.id} on Cloud Run (${newInst.cloudRunService}) in ${newInst.region}.`,
      actor: currentDeveloper.name,
    };
    setActivities((prev) => [act, ...prev]);
  };

  const updateLicenseStatus = (licenseId: string, status: LicenseStatus) => {
    setLicenses((prev) => prev.map((l) => (l.id === licenseId ? { ...l, status } : l)));
    const lic = licenses.find((l) => l.id === licenseId);
    addToast('License Updated', `License ${licenseId} status changed to ${status}`, 'info');

    const act: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      type: 'LICENSE',
      severity: status === 'ACTIVE' ? 'SUCCESS' : status === 'SUSPENDED' ? 'WARN' : 'INFO',
      installationId: lic?.installationId,
      description: `Updated license ${licenseId} status to ${status}.`,
      actor: currentDeveloper.name,
    };
    setActivities((prev) => [act, ...prev]);
  };

  const triggerDeployment = (installationId: string, targetVersion: string) => {
    setInstallations((prev) =>
      prev.map((i) => (i.id === installationId ? { ...i, deploymentStatus: 'DEPLOYING', appVersion: targetVersion } : i))
    );
    
    // Add deployment record
    const dep: DeploymentRecord = {
      id: `DEP-${Math.floor(100 + Math.random() * 900)}`,
      installationId,
      version: targetVersion,
      targetVersion,
      status: 'DEPLOYING',
      initiatedBy: currentDeveloper.name,
      deployedAt: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      releaseNotes: `Manual rolling upgrade initiated via Developer Console to ${targetVersion}.`,
    };
    setDeployments((prev) => [dep, ...prev]);

    addToast('Deployment Triggered', `Deploying version ${targetVersion} to ${installationId}`, 'info');

    // Simulate completion after 3 seconds
    setTimeout(() => {
      setInstallations((prev) =>
        prev.map((i) => (i.id === installationId ? { ...i, deploymentStatus: 'CURRENT', health: 'HEALTHY' } : i))
      );
      setDeployments((prev) =>
        prev.map((d) => (d.installationId === installationId && d.status === 'DEPLOYING' ? { ...d, status: 'CURRENT' } : d))
      );
      addToast('Deployment Successful', `Installation ${installationId} is now running ${targetVersion}`, 'success');
    }, 3500);

    const act: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      type: 'DEPLOYMENT',
      severity: 'SUCCESS',
      installationId,
      description: `Initiated deployment of version ${targetVersion} for installation ${installationId}.`,
      actor: currentDeveloper.name,
    };
    setActivities((prev) => [act, ...prev]);
  };

  const runHealthCheck = (installationId: string) => {
    addToast('Health Probe Sent', `Pinging heartbeats & Cloud Run health endpoint for ${installationId}...`, 'info');
    setTimeout(() => {
      addToast('Health Verified', `Installation ${installationId} responded successfully (Latency: 38ms).`, 'success');
      setInstallations((prev) =>
        prev.map((i) => (i.id === installationId ? { ...i, lastHeartbeat: 'Just now', health: i.health === 'CRITICAL' ? 'ATTENTION' : i.health } : i))
      );
    }, 1500);
  };

  const updateInstallationHealth = (installationId: string, health: HealthStatus, dbStatus: Installation['dbStatus']) => {
    setInstallations((prev) =>
      prev.map((i) => (i.id === installationId ? { ...i, health, dbStatus } : i))
    );
    addToast('Health State Updated', `Set ${installationId} health to ${health}`, 'warn');

    const act: ActivityRecord = {
      id: `act-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      type: 'HEALTH',
      severity: health === 'HEALTHY' ? 'SUCCESS' : health === 'CRITICAL' ? 'ERROR' : 'WARN',
      installationId,
      description: `Manual status override: Installation health set to ${health} (DB: ${dbStatus}).`,
      actor: currentDeveloper.name,
    };
    setActivities((prev) => [act, ...prev]);
  };

  return (
    <ConsoleContext.Provider
      value={{
        currentDeveloper,
        setCurrentDeveloper,
        developers: INITIAL_DEVELOPERS,
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
  const context = useContext(ConsoleContext);
  if (!context) {
    throw new Error('useConsole must be used within a ConsoleProvider');
  }
  return context;
}
