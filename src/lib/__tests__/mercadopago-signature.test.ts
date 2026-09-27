import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMercadoPagoSignature } from "../payments/mercadopago-signature";

const secret = "secreto-de-prueba";
function sign(manifest: string) {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

describe("verifyMercadoPagoSignature", () => {
  const ts = "1742505638683";
  const v1 = sign(`id:123456;request-id:req-1;ts:${ts};`);

  it("acepta una firma válida", () => {
    expect(
      verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123456", secret }),
    ).toBe(true);
  });

  it("rechaza si cambia el id del pago", () => {
    expect(
      verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "999", secret }),
    ).toBe(false);
  });

  it("rechaza sin header o con formato inválido", () => {
    expect(verifyMercadoPagoSignature({ xSignature: null, xRequestId: "req-1", dataId: "1", secret })).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: "v1=abc", xRequestId: "req-1", dataId: "1", secret })).toBe(false);
  });

  it("normaliza data.id alfanumérico a minúsculas", () => {
    const sig = sign(`id:abc123;request-id:r;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${sig}`, xRequestId: "r", dataId: "ABC123", secret })).toBe(true);
  });

  it("aplica tolerancia temporal", () => {
    expect(
      verifyMercadoPagoSignature({
        xSignature: `ts=${ts},v1=${v1}`,
        xRequestId: "req-1",
        dataId: "123456",
        secret,
        toleranceSeconds: 300,
        nowMs: Number(ts) + 3_600_000,
      }),
    ).toBe(false);
  });
});
