-- Límite de intentos de entrada (pendiente de seguridad). Cada intento queda registrado por correo e IP; tras varios
-- fallidos seguidos se bloquea la entrada un rato (recomendación de OWASP contra ataques de adivinar contraseñas).
CREATE TABLE intentos_entrada (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text,
  exito boolean NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intentos_entrada_email_idx ON intentos_entrada(email, fecha DESC);
CREATE INDEX intentos_entrada_ip_idx ON intentos_entrada(ip, fecha DESC);
-- No es información de ninguna empresa: el rol de la app no la necesita.
REVOKE ALL ON intentos_entrada FROM contable_app;
