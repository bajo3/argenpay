"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runMaintenance, settleOrder } from "@/lib/orders/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { done, errorMessage, fail, str } from "./helpers";

export async function settle(formData: FormData) {
  const s = await requireAdmin();
  const orderId = str(formData, "order_id");
  try {
    await settleOrder(orderId, s.userId, str(formData, "reference"));
  } catch (e) {
    fail("/admin", errorMessage(e));
  }
  revalidatePath("/admin");
  done("/admin", "Orden liquidada al vendedor");
}

export async function settleAllConfirmed() {
  const s = await requireAdmin();
  const db = createAdminClient();
  // Las órdenes de pago manual se liquidan una por una (cada transferencia lleva su comprobante).
  const { data } = await db.from("orders").select("id").eq("status", "confirmado").neq("payment_mode", "manual").limit(100);
  let ok = 0;
  const errors: string[] = [];
  for (const o of data ?? []) {
    try {
      await settleOrder(o.id, s.userId);
      ok++;
    } catch (e) {
      errors.push(`${o.id.slice(0, 8)}: ${errorMessage(e)}`);
    }
  }
  revalidatePath("/admin");
  if (errors.length) fail("/admin", `Liquidadas ${ok}. Con error: ${errors.join(" | ")}`);
  done("/admin", `Liquidadas ${ok} órdenes`);
}

export async function maintenance() {
  await requireAdmin();
  let msg: string;
  try {
    const r = await runMaintenance();
    msg = `Confirmadas automáticamente: ${r.confirmadas}. Vencidas sin pago: ${r.vencidas}.`;
  } catch (e) {
    fail("/admin", errorMessage(e));
  }
  revalidatePath("/admin");
  done("/admin", msg);
}
