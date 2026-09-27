-- Otorga permisos de administrador a una cuenta existente.
-- Ejecutar en Supabase → SQL Editor (o con psql) reemplazando el email.
-- No es una migración: los administradores se asignan a mano, nunca desde la app.
update public.profiles
   set is_admin = true
 where id = (select id from auth.users where email = 'tu-email@ejemplo.com');

-- Verificación
select u.email, p.display_name, p.is_admin, p.is_seller
  from auth.users u
  join public.profiles p on p.id = u.id
 where p.is_admin;
