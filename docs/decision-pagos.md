# Decisión técnica: procesador de pagos para Argenpay

Fecha de relevamiento: 26/09/2026. Fuentes: documentación oficial de Mercado Pago Developers (Argentina)
y ayuda oficial de Mobbex. **Ninguna capacidad de retención + liquidación posterior quedó confirmada**,
por lo que el MVP usa un proveedor **simulado** y la integración real queda **bloqueada por configuración**
(`src/lib/config.ts`).

## Resumen

| Pregunta | Mercado Pago | Estado |
|---|---|---|
| ¿Acepta cuentas, monedas, ítems y servicios de videojuegos? | Los términos exigen aprobación escrita previa para juegos de azar/apuestas y prohíben vender "fichas" o valores usables en otros sitios; prohíben artículos que infrinjan propiedad intelectual. No encontramos mención explícita a cuentas o bienes virtuales de videojuegos. No pudimos leer el texto completo de los términos (la página devolvió 403 al lector automático). | **Supuesto pendiente.** Requiere confirmación escrita. |
| ¿Cobrar el total, esperar la resolución y recién pagar al vendedor? | **Split 1:1** divide el dinero en la transacción: el cobro va a la cuenta del vendedor, primero se descuenta la comisión de MP y luego la del marketplace (`marketplace_fee` / `application_fee`). No es una retención hasta confirmación. La API **Pagos avanzados** (`/v1/advanced_payments`) documenta desembolsos con `money_release_date`, captura en dos pasos y cambio de fecha de liberación, pero no encontramos documentación vigente para Argentina que confirme su disponibilidad ni sus condiciones. | **No confirmado.** Split ≠ retención. |
| ¿Liquidaciones automáticas a múltiples vendedores? ¿Qué exige? | Split 1:1: sí, cada vendedor vincula su cuenta por **OAuth** (el `access_token` del vendedor se usa en cada cobro; se renueva periódicamente). La cuenta del marketplace necesita **KYC nivel 6**. El modelo **1:N** solo está disponible trabajando con el equipo comercial. | Split 1:1 documentado; 1:N y Pagos avanzados requieren acuerdo comercial. |
| Devoluciones | Hasta **180 días** desde la aprobación, parciales o totales, y **requiere saldo suficiente** en la cuenta o se rechaza. En Split 1:1 el reembolso se reparte proporcionalmente y **el marketplace no puede hacer el reembolso total si el vendedor no tiene dinero en la cuenta**. | Documentado. |
| Contracargos | Si el contracargo es válido, se retiran los fondos al vendedor y se devuelven al cliente; durante la disputa el importe queda retenido en la cuenta del vendedor. No encontramos qué ocurre con saldo insuficiente. | Parcial. Falta saldo negativo/recupero. |
| Comisiones | La comisión de MP se descuenta de lo recibido por el vendedor antes de la comisión del marketplace (Split 1:1). No encontramos si MP devuelve su comisión en un reembolso. | Parcial. |
| Disponible en Argentina | Split 1:1: Argentina figura entre los países. Checkout Pro / API de pagos / reembolsos: sí. | Confirmado. |
| Requiere acuerdo comercial | 1:N; Pagos avanzados (desembolsos con fecha de liberación) según la información disponible. | Pendiente de confirmar. |

**Mobbex** (alternativa local): su documentación de split indica que la distribución "se hace en el momento en
que se ejecuta la compra" y genera operaciones independientes por parte. No documenta retención manual,
onboarding, reembolsos ni contracargos para split. No está mejor documentado que Mercado Pago para este caso.

## Recomendación

1. **Mercado Pago como proveedor objetivo**, por madurez de API en Argentina (OAuth de vendedores, split,
   reembolsos por API, notificaciones firmadas, idempotencia con `X-Idempotency-Key`).
2. **Pedir al equipo comercial la habilitación de Pagos avanzados con liberación diferida** (o el producto
   equivalente vigente) que permita cobrar, fijar/postergar la liberación y liberar al confirmar la orden.
   Es el único camino documentado que se parece al flujo deseado.
3. Si no se aprueba, la alternativa verificada es **Split 1:1 sin retención**: el vendedor recibe al aprobarse el
   pago (menos comisiones) y los reclamos dependen de que el vendedor tenga saldo. En ese caso la interfaz no
   debe prometer retención y hay que rediseñar la política de reclamos.
4. **No** cobrar a la cuenta propia de Argenpay para pagar después a vendedores por transferencia sin asesoría
   legal/regulatoria: implica cobrar por cuenta de terceros (posible encuadre como agregador/PSP, régimen
   impositivo de retenciones y facturación).

## Qué implementa el código

- `PaymentProvider` separa **cobro**, **reembolso** y **liquidación** (`src/lib/payments/types.ts`); cada uno puede
  ser `null` y cada capacidad declara estado `verificada | no_verificada | no_soportada`.
- `simulado`: circuito completo, identificado en toda la interfaz como simulado. No mueve dinero.
- `mercadopago`: cobro con Checkout Pro, consulta oficial del pago (`GET /v1/payments/{id}`), reembolso total
  (`POST /v1/payments/{id}/refunds`) e idempotencia; **sin liquidación** (`payouts: null`). Webhook con verificación
  de `x-signature` (HMAC-SHA256 sobre `id:…;request-id:…;ts:…;`), deduplicación y conciliación de importe/moneda.
- El modo real requiere simultáneamente: `PAYMENTS_PROVIDER=mercadopago`, `PAYMENTS_REAL_CHARGES_AUTHORIZED=true`,
  `PAYMENTS_HOLD_AND_PAYOUT_VERIFIED=true`, credenciales y `NEXT_PUBLIC_SITE_URL` https. Si falta algo, el sitio
  queda en modo **bloqueado** (se puede navegar, no comprar).
- Antes de activar, falta: implementar el cobro con el mecanismo que MP apruebe (Split/OAuth o Pagos avanzados),
  el `PayoutGateway` correspondiente y la conciliación de reembolsos pendientes y contracargos por webhook.

## Preguntas para enviar a Mercado Pago (comercial / integraciones)

1. ¿Aceptan un marketplace argentino que intermedia la venta de **cuentas de videojuegos, monedas del juego,
   ítems/skins y servicios (boosting, coaching)** entre usuarios? ¿Alguna categoría está prohibida o requiere
   aprobación escrita? ¿Qué MCC/rubro nos asignarían?
2. ¿Qué producto vigente permite **cobrar el total al comprador, no liberar al vendedor hasta que el marketplace
   lo indique** (confirmación de entrega o resolución de reclamo) y luego liberar el neto? ¿"Pagos avanzados"
   (`/v1/advanced_payments`, desembolsos con `money_release_date` y liberación manual) está disponible en Argentina
   para nuestra cuenta? ¿Qué plazo máximo de retención admite?
3. ¿Es posible fijar la liberación "a demanda" o solo una fecha? ¿Se puede adelantar o postergar por API?
4. Durante la retención, ¿de quién son los fondos y en qué cuenta figuran? ¿Quién es el comercio frente al
   comprador y frente al emisor de la tarjeta?
5. Requisitos de vinculación de vendedores: tipo de cuenta, nivel de KYC, personas humanas vs. jurídicas, CUIT
   obligatorio, límites de monto, vigencia y renovación del token OAuth.
6. Reembolsos en split/desembolsos: ¿se reembolsa la comisión del marketplace (`application_fee`) y la de MP?
   ¿Qué pasa si el vendedor no tiene saldo? ¿Se puede reembolsar desde la cuenta del marketplace?
7. Contracargos: ¿a quién se debita (vendedor o marketplace)? ¿Qué pasa con saldo insuficiente (saldo negativo,
   débito a CBU, compensación con ventas futuras)? ¿Plazos y documentación para disputar bienes digitales?
8. Comisiones y plazos de acreditación aplicables a nuestra cuenta y a las de los vendedores, e impuestos o
   retenciones que aplica MP (IIBB, Ganancias/IVA) en cada parte del split.
9. ¿Hay límite de vendedores, de montos por operación o de volumen mensual? ¿Se requiere acuerdo comercial?
10. Notificaciones: ¿qué eventos se envían para desembolsos, liberaciones, reembolsos y contracargos, y cómo se
    firman?
11. ¿Hay entorno de pruebas que reproduzca retención y liberación, para validar antes de producción?

## Otros pendientes antes de vender estas categorías

- Revisión legal: términos de uso de cada juego (muchos prohíben vender cuentas), propiedad intelectual,
  defensa del consumidor (arrepentimiento en bienes digitales), protección de datos personales (Ley 25.326)
  e impuestos (facturación de la comisión, retenciones).
- Política de reclamos, plazos y evidencia exigible por categoría.
- Verificación de identidad de vendedores y límites por antigüedad.

## Modo manual (transferencia / QR / Binance / cripto)

`PAYMENTS_PROVIDER=manual` (requiere `PAYMENTS_REAL_CHARGES_AUTHORIZED=true`). No usa procesador: el comprador
transfiere a los datos de cobro de Argenpay, avisa con el TXID/comprobante y **un administrador confirma a mano**.

- Datos de cobro editables en `/admin` (CVU, alias, QR, Binance Pay ID, direcciones USDT/USDC/BTC). Vienen **genéricos**
  y con el aviso "no transferir" hasta que se marcan como definitivos.
- El pago recién se toma como recibido cuando el administrador lo confirma (`sys_review_manual_payment` →
  `sys_confirm_payment` con proveedor `manual`). El frontend nunca marca una orden como pagada.
- Un aviso pendiente frena el vencimiento de la orden; una referencia/TXID no puede usarse en dos avisos vigentes.
- Reembolsos y liquidaciones son manuales: solo un administrador los registra (con el comprobante de la transferencia).
- Avisos al titular: campana/contador en el encabezado (en vivo), y opcionalmente Telegram o ntfy
  (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `NTFY_TOPIC`).
- **Pendiente legal/impositivo (no lo resuelve el código):** recibir dinero de terceros en una cuenta propia y pagarlo
  después sigue siendo cobrar por cuenta de terceros (ver punto 4 de la recomendación). Consultar contador y abogado
  antes de operar con dinero real; la interfaz no debe hablar de "dinero protegido" ni "fondos retenidos".
