-- Las transferencias del proveedor simulado también se usan para retiros de saldo:
-- order_id pasa a ser una referencia genérica (orden o retiro).
alter table public.sim_payouts drop constraint if exists sim_payouts_order_id_fkey;
alter table public.sim_payouts rename column order_id to reference_id;
