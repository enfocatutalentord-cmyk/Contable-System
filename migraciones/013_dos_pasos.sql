-- Verificación en dos pasos (29-oct-2026, aprobada por Joannie). Después de la contraseña se pide el código de 6 dígitos
-- de una app de autenticación (Google Authenticator, Microsoft Authenticator, Authy…), como exige Xero a sus usuarios.
-- Código TOTP (RFC 6238, 30 s, SHA-1, 6 dígitos), códigos de recuperación de un solo uso y aviso por correo de cada
-- cambio, según la guía de OWASP (Multifactor Authentication Cheat Sheet) y NIST SP 800-63B.

ALTER TABLE usuarios
  ADD COLUMN dos_pasos_secreto text,          -- clave del autenticador (base32); NULL = sin verificación en dos pasos
  ADD COLUMN dos_pasos_desde timestamptz,     -- cuándo la activó (NULL mientras solo la está configurando)
  ADD COLUMN dos_pasos_ultimo bigint;         -- último intervalo de 30 s aceptado: un mismo código no sirve dos veces
-- El rol de la app solo lee id, email y nombre de usuarios (001_base.sql); estas columnas quedan fuera de su alcance.

-- La firma puede exigirla a todo su equipo y a los usuarios de sus clientes.
ALTER TABLE firmas ADD COLUMN exigir_dos_pasos boolean NOT NULL DEFAULT false;

CREATE TABLE codigos_recuperacion (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash text NOT NULL,                  -- sha256 del código; el código solo se muestra una vez
  usado timestamptz,
  PRIMARY KEY (usuario_id, codigo_hash)
);

-- Paso intermedio entre la contraseña correcta y el código: no es una sesión, solo permite escribir el código.
CREATE TABLE entradas_pendientes (
  token_hash text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  destino text NOT NULL DEFAULT '/empresas',
  expira timestamptz NOT NULL,
  fallos int NOT NULL DEFAULT 0
);
CREATE INDEX entradas_pendientes_usuario_idx ON entradas_pendientes(usuario_id);

REVOKE ALL ON codigos_recuperacion, entradas_pendientes FROM contable_app;
