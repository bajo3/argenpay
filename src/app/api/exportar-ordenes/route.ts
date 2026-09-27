import { NextResponse, type NextRequest } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { listMyOrders } from "@/lib/orders/list";
import { STATUS_LABELS } from "@/lib/orders/state-machine";

/** Exporta compras o ventas del usuario a CSV (compatible con Excel). */
export async function GET(req: NextRequest) {
  const s = await getSessionProfile();
  if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const role = sp.get("rol") === "ventas" ? "vendedor" : "comprador";
  const rows = await listMyOrders(
    s.userId,
    role,
    { code: sp.get("orden") ?? "", user: sp.get("usuario") ?? "", status: sp.get("estado") ?? "" },
    5000,
  );
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Fecha", "Orden", "Servidor", "Descripción", "Categoría", "Cantidad", role === "comprador" ? "Vendedor" : "Comprador", "Estado", role === "comprador" ? "Total ARS" : "Neto ARS"];
  const lines = rows.map((o) =>
    [
      new Date(o.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
      o.code,
      o.listing_snapshot.server ?? "Todos",
      o.listing_snapshot.title,
      o.listing_snapshot.category,
      o.quantity,
      o.counterpart?.display_name,
      STATUS_LABELS[o.status],
      ((role === "comprador" ? Number(o.price_cents) : Number(o.seller_net_cents)) / 100).toFixed(2).replace(".", ","),
    ]
      .map(esc)
      .join(";"),
  );
  const csv = "﻿" + [header.map(esc).join(";"), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="argenpay-${role === "comprador" ? "compras" : "ventas"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
