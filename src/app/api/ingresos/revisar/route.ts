import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { checkIncomingDeposits } from "@/lib/deposit-watch";

/**
 * Revisa los ingresos de Binance y avisa si entró dinero. La llaman:
 *  · el programador de la base (pg_cron, cada minuto) con "Authorization: Bearer <CRON_SECRET>";
 *  · el panel de un administrador mientras tiene el sitio abierto (con su sesión).
 * Corre en São Paulo (vercel.json → functions) porque Binance rechaza pedidos desde EE. UU.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

async function handle(req: NextRequest) {
  const cron = cronAuthorized(req);
  if (!cron) {
    const s = await getSessionProfile();
    if (!s?.profile.is_admin) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("forzar") === "1" && !cron;
  try {
    const result = await checkIncomingDeposits({ force });
    return NextResponse.json({ ...result, region: process.env.VERCEL_REGION ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
