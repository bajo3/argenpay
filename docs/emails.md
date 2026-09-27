# Emails de Argenpay (sin la marca "Supabase")

Supabase Auth envía los emails de confirmación, recuperación, etc. Por defecto salen como
**"Supabase Auth" &lt;noreply@mail.app.supabase.io&gt;** y con textos en inglés.

| Qué cambiar | Cómo | ¿Necesita SMTP propio? |
|---|---|---|
| Asunto y texto del email | Plantillas de `supabase/templates/` | Sí, en proyectos alojados en supabase.com |
| Nombre y dirección del remitente ("Argenpay &lt;no-responder@tudominio.com&gt;") | SMTP propio | Sí |
| Límite de envíos (el SMTP de Supabase permite muy pocos por hora) | SMTP propio | Sí |

## 1. Configurar un SMTP propio

En Supabase: **Project Settings → Authentication → SMTP Settings → Enable custom SMTP**.

- **Sender email:** `no-responder@tudominio.com` (un dominio propio verificado).
- **Sender name:** `Argenpay`
- **Host / puerto / usuario / contraseña:** los que te da el proveedor. Opciones: Resend, Brevo, Postmark,
  Amazon SES o el correo de tu hosting (por ejemplo, Hostinger: `smtp.hostinger.com`, puerto 465).
- Verificá SPF y DKIM del dominio en el proveedor para que no caigan en spam.

## 2. Cargar las plantillas

En Supabase: **Authentication → Email Templates**. Para cada una, copiar el asunto y pegar el HTML del archivo:

| Plantilla | Asunto | Archivo |
|---|---|---|
| Confirm signup | Confirmá tu cuenta en Argenpay | `supabase/templates/confirmacion.html` |
| Reset password | Restablecé tu contraseña de Argenpay | `supabase/templates/recuperacion.html` |
| Magic link | Tu enlace para ingresar a Argenpay | `supabase/templates/enlace-magico.html` |
| Change email address | Confirmá tu nuevo email en Argenpay | `supabase/templates/cambio-email.html` |
| Invite user | Te invitaron a Argenpay | `supabase/templates/invitacion.html` |

Los enlaces apuntan a `{{ .SiteURL }}/auth/confirmar?token_hash=…&type=…`, que procesa la ruta
`src/app/auth/confirmar/route.ts`.

## 3. URL del sitio

En **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000` mientras pruebes en tu PC; la URL real (https) cuando se publique.
- **Redirect URLs:** agregar `http://localhost:3000/**` y la URL de producción.

En local (`npx supabase start`) las plantillas ya se aplican solas desde `supabase/config.toml`.
