'use client';

import { useCallback, useState } from 'react';
import type { LicenseAdminAction, LicenseActionPayload } from './types';
import { consoleLicenseErrorMessage, dispatchLicenseAction, isLicenseConflict, licenseActionSuccessMessage } from './license-admin-actions';

export function useLicenseAdminActions({ organizationId, refresh, onConflict }: { organizationId?: string; refresh: () => Promise<void>; onConflict?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runAction = useCallback(async (action: LicenseAdminAction, payload: LicenseActionPayload = {}) => {
    if (!organizationId) return false;
    setBusy(true);
    setMessage(null);
    try {
      await dispatchLicenseAction(organizationId, action, payload);
      await refresh();
      setMessage(licenseActionSuccessMessage(action, payload));
      return true;
    } catch (error) {
      setMessage(consoleLicenseErrorMessage(error));
      if (isLicenseConflict(error)) {
        onConflict?.();
        try { await refresh(); } catch { /* Keep the safe server conflict visible. */ }
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [onConflict, organizationId, refresh]);

  return { busy, message, runAction, setMessage };
}
