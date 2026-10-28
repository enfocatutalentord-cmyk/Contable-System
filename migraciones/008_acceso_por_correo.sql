-- Acceso por correo (28-oct-2026, pedido de Joannie: las contraseñas temporales no llegaban a las personas).
-- Al agregar a alguien, el sistema le envía un enlace de un solo uso; al abrirlo verifica su correo y crea su propia
-- contraseña antes de entrar por primera vez. El mismo enlace sirve para «¿Olvidaste tu contraseña?» y para que un
-- administrador reenvíe el acceso. Como en Xero y QuickBooks Online, que invitan por correo y no muestran claves.
ALTER TABLE usuarios ADD COLUMN correo_verificado timestamptz;

CREATE TABLE enlaces_acceso (
  token_hash text PRIMARY KEY,               -- sha256 del token; el token solo viaja en el correo
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('invitacion', 'recuperacion')),
  creado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  creado timestamptz NOT NULL DEFAULT now(),
  expira timestamptz NOT NULL,
  usado timestamptz
);
CREATE INDEX enlaces_acceso_usuario_idx ON enlaces_acceso(usuario_id, creado DESC);
-- No es información de ninguna empresa: el rol de la app no la necesita.
REVOKE ALL ON enlaces_acceso FROM contable_app;
