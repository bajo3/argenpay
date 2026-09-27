# Argenpay · Lineage 2 LU4

Mercado entre jugadores de **Lineage 2 LU4** (lu4.org): adena por **kk**, cuentas y personajes, ítems y servicios,
en pesos argentinos. Comisión del 10% por operación. Next.js 16 (App Router) + TypeScript + Supabase, pensado para Vercel.

- Servidores: Carmine (UTC-3, latinoamericano), Gamma, Black y White (editables en la tabla `game_servers`).
- Lotes con servidor, precio por unidad (kk para adena), disponibilidad, compra mínima, entrega estimada y, para cuentas,
  raza, clase y nivel. Filtros por servidor, categoría, precio, raza, nivel y "solo vendedores en línea".
- Chat entre usuarios en tiempo real (Supabase Realtime + respaldo por consulta). Cada orden publica sus eventos
  como mensajes de sistema en el chat del comprador con el vendedor.
- Presencia en línea, perfiles públicos de vendedor y reseñas (1–5) después de confirmar la orden.

> **Pagos:** el MVP funciona con un proveedor **simulado** (no mueve dinero). La integración con Mercado Pago
> está implementada parcialmente y **bloqueada por configuración** hasta confirmar con el proveedor que se puede
> cobrar, esperar la resolución y luego liquidar. Ver [`docs/decision-pagos.md`](docs/decision-pagos.md).

## Puesta en marcha local

Requisitos: Node 20.9+, Docker Desktop (para Supabase local).

```bash
npm install
npx supabase start          # levanta Postgres/Auth/Storage y aplica migraciones + seed
npx supabase status         # copiar API URL, anon key y service_role key
cp .env.example .env.local  # completar las claves
npm run dev
```

Crear un administrador (Supabase → SQL Editor; también está en `supabase/scripts/hacer-admin.sql`):

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'tu-email@ejemplo.com');
```

## Comprobaciones

```bash
npm run check         # typecheck + lint + tests unitarios + prueba de la base (PGlite, sin Docker)
npm run test:queries  # valida las consultas de las páginas contra el Supabase de .env.local (solo lectura)
npm run build     # NODE_ENV debe ser "production" (o no estar definido)
```

`npm run test:db` aplica las migraciones en Postgres embebido (PGlite) con stubs de `auth`/`storage` y recorre el
flujo completo verificando RLS, permisos, importes, idempotencia y transiciones.

## Flujo de estados

| Acción | Quién | Desde | Hacia |
|---|---|---|---|
| Crear orden | comprador | — | `pendiente_pago` |
| Confirmar pago (tras verificar con el procesador) | sistema | `pendiente_pago` | `pago_confirmado` |
| Cancelar | comprador, admin | `pendiente_pago` | `cancelado` |
| Vencer sin pago | sistema (cron) | `pendiente_pago` | `cancelado` |
| Iniciar entrega | vendedor | `pago_confirmado` | `entrega_en_curso` |
| Marcar entregado (con evidencia) | vendedor | `pago_confirmado`, `entrega_en_curso` | `entregado` |
| Confirmar recepción | comprador | `entregado` | `confirmado` |
| Confirmación automática (vence ventana) | sistema (cron) | `entregado` | `confirmado` |
| Abrir reclamo | comprador | `entregado`; o `pago_confirmado`/`entrega_en_curso` si venció el plazo | `en_reclamo` |
| Resolver a favor del vendedor | admin | `en_reclamo` | `confirmado` |
| Reembolso total | vendedor, admin | `pago_confirmado`, `entrega_en_curso`, `en_reclamo` | `reembolsado` |
| Liquidar neto al vendedor | admin, sistema | `confirmado` | `liquidado` |

La base de datos es la fuente de verdad (`public.order_action` y funciones `sys_*`, estas últimas ejecutables
solo con `service_role`). `src/lib/orders/state-machine.ts` es el espejo para la interfaz y los tests.

## Importes

- Centavos enteros (`bigint`), moneda ARS.
- `comisión = floor((precio × 1000 + 5000) / 10000)` → 10% redondeado al centavo, mitad hacia arriba.
- El cargo del procesador se calcula igual con sus puntos básicos y se asigna según `processor_fee_policy`
  (`plataforma_absorbe`: el vendedor recibe el 90% exacto; `vendedor_absorbe`: se descuenta del neto).
- Cada orden guarda precio, comisión, cargo del procesador, neto del vendedor y neto de la plataforma; un trigger
  impide modificarlos (incluso con `service_role`) y hay `CHECK` que validan la aritmética.

## Seguridad

- RLS en todas las tablas. Los clientes no tienen `INSERT/UPDATE/DELETE` sobre órdenes, pagos, eventos, reclamos
  ni evidencias: todo pasa por funciones `SECURITY DEFINER` que validan actor y estado.
- El navegador nunca confirma un pago: el servidor consulta el estado oficial del cobro y concilia importe y
  moneda; las transacciones son idempotentes (`unique(provider, kind, provider_ref)`).
- Los datos de cobro de vendedores solo los ven el dueño y administradores. Las evidencias van a un bucket privado.
- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en módulos `server-only`.

## Probar el circuito simulado

1. Crear dos cuentas (vendedor y comprador) y un admin (SQL de arriba).
2. Vendedor: **Mi cuenta → Activar perfil de vendedor**, cargar datos de cobro de prueba (p. ej. CUIT
   `20123456789`, alias `vendedor.prueba`), y **Panel de vendedor → Nueva publicación**.
3. Comprador: abrir la oferta → **Comprar** → **Pagar (simulado)** → **Aprobar pago simulado**. La orden pasa a
   *Pago confirmado* tras la conciliación del servidor.
4. Vendedor: en la orden, **Iniciar entrega** → **Marcar como entregado** con evidencia (texto y archivo opcional).
5. Camino feliz: comprador **Confirmar recepción** → admin **Administración → Liquidar**. Estado: *Liquidado*.
6. Reclamo: en otra orden entregada, comprador **Abrir reclamo** → admin resuelve **A favor del vendedor**
   (pasa a *Confirmado* y se puede liquidar) o **Reembolsar al comprador** (*Reembolsado*).
7. Reembolso sin reclamo: el vendedor puede devolver el dinero desde la orden si no puede entregar.
8. **Ejecutar mantenimiento** en Administración aplica la confirmación automática y vence órdenes impagas
   (en producción lo hace el cron de `vercel.json`).

## Despliegue

No publicar ni activar cobros reales sin autorización. Para Vercel: crear proyecto Supabase, aplicar
`supabase/migrations` (`npx supabase db push`), cargar variables de `.env.example` en Vercel y configurar
`CRON_SECRET`. Mantener `PAYMENTS_PROVIDER=simulado` o las banderas de autorización en `false`.
