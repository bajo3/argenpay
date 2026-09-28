import { describe, expect, it } from "vitest";
import { realMethods } from "../manual-methods";

const factory = {
  cvu: "0000000000000000000000",
  alias: "ejemplo.alias.argenpay",
  binancePayId: "00000000",
  wallets: [
    { address: "REEMPLAZAR-DIRECCION-USDT-TRC20" },
    { address: "REEMPLAZAR-DIRECCION-BTC" },
  ],
};

describe("realMethods", () => {
  it("los datos genéricos de fábrica no cuentan como medios reales", () => {
    expect(realMethods(factory)).toEqual({ cvu: false, alias: false, binance: false, crypto: false });
  });

  it("reconoce un CVU de 22 dígitos, un alias propio y un Binance ID", () => {
    const r = realMethods({ ...factory, cvu: "0000003100012345678901", alias: "mi.alias.pago", binancePayId: "123456789" });
    expect(r).toMatchObject({ cvu: true, alias: true, binance: true, crypto: false });
  });

  it("rechaza CVU con largo incorrecto o letras", () => {
    expect(realMethods({ ...factory, cvu: "12345" }).cvu).toBe(false);
    expect(realMethods({ ...factory, cvu: "00000031000123456789ab" }).cvu).toBe(false);
  });

  it("acepta una dirección cripto real y descarta las cortas o de ejemplo", () => {
    expect(realMethods({ ...factory, wallets: [{ address: "TXYZabcdefghijklmnopqrstuvwxyz1234" }] }).crypto).toBe(true);
    expect(realMethods({ ...factory, wallets: [{ address: "corta" }] }).crypto).toBe(false);
    expect(realMethods({ ...factory, wallets: [{ address: "DIRECCION-DE-EJEMPLO-NO-ENVIAR-FONDOS" }] }).crypto).toBe(false);
  });
});
