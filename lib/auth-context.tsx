'use client';

import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { PlatformAdmin, PlatformAdminRole, PlatformAdminStatus } from './types';
import { firebaseAuth, firestore } from './firebase';

type AuthStatus = 'loading' | 'signed-out' | 'unauthorized' | 'disabled' | 'authorized' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  platformAdmin: PlatformAdmin | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

function platformAdminFromSnapshot(user: User, data: Record<string, unknown>): PlatformAdmin | null {
  const role = data.role;
  const status = data.status;

  if ((status !== 'ACTIVE' && status !== 'DISABLED') || (role !== 'SUPER_ADMIN' && role !== 'SUPPORT')) {
    return null;
  }

  return {
    id: user.uid,
    email: typeof data.email === 'string' ? data.email : user.email || '',
    displayName: typeof data.displayName === 'string' ? data.displayName : user.displayName || user.email || 'Platform administrator',
    role: role as PlatformAdminRole,
    status: status as PlatformAdminStatus,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState<PlatformAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setError(null);
      setUser(nextUser);
      setPlatformAdmin(null);

      if (!nextUser) {
        setStatus('signed-out');
        return;
      }

      try {
        const adminSnapshot = await getDoc(doc(firestore, 'platformAdmins', nextUser.uid));
        const nextAdmin = adminSnapshot.exists()
          ? platformAdminFromSnapshot(nextUser, adminSnapshot.data())
          : null;

        if (!nextAdmin) {
          setStatus('unauthorized');
          return;
        }

        setPlatformAdmin(nextAdmin);
        if (nextAdmin.status === 'DISABLED') {
          setStatus('disabled');
          return;
        }
        setStatus('authorized');
      } catch (authError) {
        console.error('Unable to verify developer authorization.', authError);
        setError('We could not verify your developer access. Please try again.');
        setStatus('error');
      }
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    platformAdmin,
    error,
    signInWithGoogle: async () => {
      setError(null);
      await signInWithPopup(firebaseAuth, googleProvider);
    },
    signOut: () => firebaseSignOut(firebaseAuth),
  }), [platformAdmin, error, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
