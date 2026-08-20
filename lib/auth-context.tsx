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
import { DeveloperRole, DeveloperUser } from './types';
import { firebaseAuth, firestore } from './firebase';

type AuthStatus = 'loading' | 'signed-out' | 'unauthorized' | 'authorized' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  developer: DeveloperUser | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

function developerFromSnapshot(user: User, data: Record<string, unknown>): DeveloperUser | null {
  const role = data.role;
  const active = data.active;

  if (active === false || (role !== 'OWNER' && role !== 'DEVELOPER' && role !== 'SUPPORT')) {
    return null;
  }

  return {
    id: user.uid,
    name: typeof data.name === 'string' ? data.name : user.displayName || user.email || 'Developer',
    email: typeof data.email === 'string' ? data.email : user.email || '',
    role: role as DeveloperRole,
    avatar: typeof data.avatar === 'string' ? data.avatar : user.photoURL || '',
    lastLogin: new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [developer, setDeveloper] = useState<DeveloperUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setError(null);
      setUser(nextUser);
      setDeveloper(null);

      if (!nextUser) {
        setStatus('signed-out');
        return;
      }

      try {
        const developerSnapshot = await getDoc(doc(firestore, 'developers', nextUser.uid));
        const nextDeveloper = developerSnapshot.exists()
          ? developerFromSnapshot(nextUser, developerSnapshot.data())
          : null;

        if (!nextDeveloper) {
          setStatus('unauthorized');
          return;
        }

        setDeveloper(nextDeveloper);
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
    developer,
    error,
    signInWithGoogle: async () => {
      setError(null);
      await signInWithPopup(firebaseAuth, googleProvider);
    },
    signOut: () => firebaseSignOut(firebaseAuth),
  }), [developer, error, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
