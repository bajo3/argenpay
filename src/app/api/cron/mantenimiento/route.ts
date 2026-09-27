import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runMaintenance } from "@/lib/orders/service";

/** Confirmación automática y vencimiento de órdenes impagas. Protegido con CRON_SECRET (Vercel Cron). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const result = await runMaintenance();
  return NextResponse.json(result);
}
