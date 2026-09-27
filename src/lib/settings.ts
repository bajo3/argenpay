import "server-only";
import type { ProcessorFeePolicy } from "@/lib/fees";
import { createClient } from "@/lib/supabase/server";

export interface PlatformSettings {
  commissionBps: number;
  processorFeeBps: number;
  processorFeePolicy: ProcessorFeePolicy;
  autoConfirmHours: number;
  pendingPaymentMinutes: number;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("*").single();
  return {
    commissionBps: data?.commission_bps ?? 1000,
    processorFeeBps: data?.processor_fee_bps ?? 0,
    processorFeePolicy: (data?.processor_fee_policy as ProcessorFeePolicy) ?? "plataforma_absorbe",
    autoConfirmHours: data?.auto_confirm_hours ?? 72,
    pendingPaymentMinutes: data?.pending_payment_minutes ?? 60,
  };
}
