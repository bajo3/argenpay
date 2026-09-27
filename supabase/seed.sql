-- Datos base (sin usuarios ni secretos). El catálogo LU4 (juego, servidores y categorías)
-- lo crea la migración 20260927000001_lu4.sql.
insert into public.regions (code, name) values
  ('LATAM', 'Latinoamérica'),
  ('EU', 'Europa'),
  ('GLOBAL', 'Global')
on conflict (code) do nothing;

-- Cargo del procesador SIMULADO (3%) absorbido por la plataforma: el vendedor recibe el 90% exacto.
update public.platform_settings
   set processor_fee_bps = 300, processor_fee_policy = 'plataforma_absorbe'
 where id;
