'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Chrome, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export function AuthScreen() {
  const { status, error, signInWithGoogle, signOut } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      if (status === 'unauthorized') {
        await signOut();
      }
      await signInWithGoogle();
    } catch (authError) {
      if ((authError as { code?: string }).code !== 'auth/popup-closed-by-user') {
        setSignInError('Google sign-in was not completed. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const isUnauthorized = status === 'unauthorized';
  const isError = status === 'error' || Boolean(signInError);

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-slate-900 px-8 py-7 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center font-black text-2xl">B</div>
            <div>
              <p className="font-black tracking-tight text-lg">BSM CONSOLE</p>
              <p className="text-xs text-slate-400">Private developer administration</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-9">
          {status === 'loading' && (
            <div className="py-8 text-center text-slate-500">
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600" />
              <p className="text-sm font-medium">Verifying your session…</p>
            </div>
          )}

          {status === 'signed-out' && (
            <>
              <ShieldCheck className="h-10 w-10 text-blue-600 mb-5" />
              <h1 className="text-2xl font-black text-slate-950">Developer access required</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Sign in with your Google account to continue. Access is granted only to approved developer records.</p>
              <button onClick={handleSignIn} disabled={isSigningIn} className="mt-7 w-full flex items-center justify-center gap-3 rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
                {isSigningIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Chrome className="h-4 w-4" />}
                Continue with Google
              </button>
            </>
          )}

          {isUnauthorized && (
            <>
              <AlertCircle className="h-10 w-10 text-rose-600 mb-5" />
              <h1 className="text-2xl font-black text-slate-950">Access not authorized</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">Your Google account is not listed as an active developer for this console.</p>
              <button onClick={handleSignIn} className="mt-7 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Try another account</button>
            </>
          )}

          {isError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <div className="flex gap-2"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{signInError || error}</div>
              <button onClick={handleSignIn} className="mt-4 font-bold underline">Try again</button>
            </div>
          )}

          {isUnauthorized && <button onClick={() => void signOut()} className="mt-4 w-full text-xs font-semibold text-slate-400 hover:text-slate-700">Sign out</button>}
          {status === 'authorized' && <div className="flex items-center justify-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Access verified</div>}
        </div>
      </section>
    </main>
  );
}
