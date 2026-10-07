import { bootstrapDefaultSubscriptionPlans, listSubscriptionPlans, updateSubscriptionPlan } from './subscription-plan-service';
import { requirePlatformAdminToken } from './platform-admin';

export async function handleSubscriptionPlanList(idToken: string) {
  await requirePlatformAdminToken(idToken);
  return listSubscriptionPlans();
}

export async function handleSubscriptionPlanUpdate(idToken: string, planId: string, body: Record<string, unknown>) {
  const actor = await requirePlatformAdminToken(idToken, ['SUPER_ADMIN']);
  return updateSubscriptionPlan(planId, body, actor);
}

export async function handleSubscriptionPlanBootstrap(idToken: string) {
  const actor = await requirePlatformAdminToken(idToken, ['SUPER_ADMIN']);
  return bootstrapDefaultSubscriptionPlans(actor);
}
