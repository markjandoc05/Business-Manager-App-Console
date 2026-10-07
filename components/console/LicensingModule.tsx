'use client';

import React from 'react';
import { SubscriptionOperationsModule } from './SubscriptionOperationsModule';
import { SubscriptionPlansModule } from './SubscriptionPlansModule';

/**
 * The licensing page composes platform plan controls with the sanitized
 * subscription operations projection. Client App/CRM modules do not
 * participate in this screen.
 */
export function LicensingModule() {
  return <div className="space-y-6">
    <details className="group rounded-xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div><h2 className="font-black text-gray-950">Plan catalog</h2><p className="mt-1 text-sm text-gray-500">Commercial plan configuration and public-signup controls.</p></div>
        <span className="text-xs font-bold text-blue-700 group-open:hidden">Show plans</span><span className="hidden text-xs font-bold text-blue-700 group-open:inline">Hide plans</span>
      </summary>
      <div className="border-t border-gray-100 p-5"><SubscriptionPlansModule /></div>
    </details>
    <SubscriptionOperationsModule />
  </div>;
}
