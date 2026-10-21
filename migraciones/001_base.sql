-- Fase 1: empresas, usuarios y roles, catálogo de cuentas, asientos y fecha de bloqueo.
-- Cada tabla con empresa_id queda aislada con Row Level Security: la app fija
-- app.empresa_id en cada transacción y la base solo deja ver/escribir esa empresa.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  nombre text NOT NULL,
  clave_hash text NOT NULL,
  creado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
  token_hash text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira timestamptz NOT NULL,
  creada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sesiones_usuario_idx ON sesiones(usuario_id);

CREATE TABLE empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  rnc text,
  moneda text NOT NULL DEFAULT 'DOP',
  -- Como las «lock dates» de Xero: nada con fecha igual o anterior se puede crear, cambiar ni anular.
  fecha_bloqueo date,
  creada timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE miembros (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol text NOT NULL CHECK (rol IN ('dueno', 'contador', 'auxiliar', 'lectura')),
  creado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);
CREATE INDEX miembros_usuario_idx ON miembros(usuario_id);

CREATE TABLE cuentas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto')),
  padre_id uuid REFERENCES cuentas(id),
  nivel int NOT NULL CHECK (nivel BETWEEN 1 AND 6),
  -- Solo las cuentas de detalle reciben movimientos; las de grupo suman a sus hijas.
  de_detalle boolean NOT NULL DEFAULT true,
  activa boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, codigo)
);
CREATE INDEX cuentas_padre_idx ON cuentas(padre_id);

CREATE TABLE asientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  fecha date NOT NULL,
  concepto text NOT NULL,
  referencia text,
  origen text NOT NULL DEFAULT 'manual',
  anulado boolean NOT NULL DEFAULT false,
  anulado_por uuid REFERENCES usuarios(id),
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX asientos_fecha_idx ON asientos(empresa_id, fecha);

CREATE TABLE lineas_asiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id uuid NOT NULL REFERENCES asientos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  descripcion text,
  debe numeric(18,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber numeric(18,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  CHECK ((debe > 0) <> (haber > 0))
);
CREATE INDEX lineas_asiento_idx ON lineas_asiento(asiento_id);
CREATE INDEX lineas_cuenta_idx ON lineas_asiento(empresa_id, cuenta_id);

CREATE TABLE bitacora (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES usuarios(id),
  accion text NOT NULL,
  detalle jsonb,
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bitacora_empresa_idx ON bitacora(empresa_id, fecha DESC);

-- Reglas contables que la base hace cumplir aunque la app falle.

-- 1) Un asiento siempre cuadra (debe = haber) y tiene al menos dos líneas. Se revisa al final de la transacción.
CREATE FUNCTION revisar_cuadre() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  aid uuid := COALESCE(NEW.asiento_id, OLD.asiento_id);
  d numeric; h numeric; n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM asientos WHERE id = aid) THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(debe), 0), COALESCE(sum(haber), 0), count(*) INTO d, h, n
    FROM lineas_asiento WHERE asiento_id = aid;
  IF n < 2 THEN RAISE EXCEPTION 'El asiento necesita al menos dos líneas' USING ERRCODE = 'check_violation'; END IF;
  IF d <> h THEN RAISE EXCEPTION 'El asiento no cuadra: debe % y haber %', d, h USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lineas_cuadre AFTER INSERT OR UPDATE OR DELETE ON lineas_asiento
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION revisar_cuadre();

-- 2) Las líneas solo usan cuentas de detalle, activas y de la misma empresa.
CREATE FUNCTION revisar_cuenta_linea() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas c JOIN asientos a ON a.id = NEW.asiento_id
                  WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id
                    AND a.empresa_id = NEW.empresa_id AND c.de_detalle AND c.activa) THEN
    RAISE EXCEPTION 'La cuenta no existe, no es de detalle o está inactiva' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lineas_cuenta BEFORE INSERT OR UPDATE ON lineas_asiento
  FOR EACH ROW EXECUTE FUNCTION revisar_cuenta_linea();

-- 3) Nada se crea, cambia o anula en un período bloqueado.
CREATE FUNCTION revisar_bloqueo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bloqueo date;
BEGIN
  SELECT fecha_bloqueo INTO bloqueo FROM empresas WHERE id = COALESCE(NEW.empresa_id, OLD.empresa_id);
  IF bloqueo IS NOT NULL AND (
       (TG_OP <> 'INSERT' AND OLD.fecha <= bloqueo) OR (TG_OP <> 'DELETE' AND NEW.fecha <= bloqueo)) THEN
    RAISE EXCEPTION 'El período está cerrado hasta el %', to_char(bloqueo, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER asientos_bloqueo BEFORE INSERT OR UPDATE OR DELETE ON asientos
  FOR EACH ROW EXECUTE FUNCTION revisar_bloqueo();

CREATE FUNCTION revisar_bloqueo_linea() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bloqueo date; f date;
BEGIN
  SELECT e.fecha_bloqueo, a.fecha INTO bloqueo, f FROM asientos a JOIN empresas e ON e.id = a.empresa_id
   WHERE a.id = COALESCE(NEW.asiento_id, OLD.asiento_id);
  IF bloqueo IS NOT NULL AND f <= bloqueo THEN
    RAISE EXCEPTION 'El período está cerrado hasta el %', to_char(bloqueo, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER lineas_bloqueo BEFORE INSERT OR UPDATE OR DELETE ON lineas_asiento
  FOR EACH ROW EXECUTE FUNCTION revisar_bloqueo_linea();

-- 4) Los asientos no se borran: se anulan (queda rastro, como exige una auditoría).
CREATE FUNCTION impedir_borrado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los asientos no se borran; se anulan' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER asientos_sin_borrado BEFORE DELETE ON asientos
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION impedir_borrado();

-- Aislamiento por empresa.
CREATE FUNCTION empresa_actual() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.empresa_id', true), '')::uuid
$$;

ALTER TABLE cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas FORCE ROW LEVEL SECURITY;
CREATE POLICY cuentas_empresa ON cuentas USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

ALTER TABLE asientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos FORCE ROW LEVEL SECURITY;
CREATE POLICY asientos_empresa ON asientos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

ALTER TABLE lineas_asiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineas_asiento FORCE ROW LEVEL SECURITY;
CREATE POLICY lineas_empresa ON lineas_asiento USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

ALTER TABLE bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora FORCE ROW LEVEL SECURITY;
CREATE POLICY bitacora_empresa ON bitacora USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

-- Rol con el que trabaja la app dentro de cada transacción (SET LOCAL ROLE). No tiene BYPASSRLS,
-- así el aislamiento por empresa se cumple aunque el usuario de conexión (p. ej. el dueño en Neon) lo tenga.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contable_app') THEN
    CREATE ROLE contable_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT contable_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO contable_app;
GRANT SELECT, INSERT, UPDATE ON cuentas, asientos, lineas_asiento, empresas TO contable_app;
GRANT SELECT, INSERT ON bitacora TO contable_app;
GRANT DELETE ON lineas_asiento TO contable_app;
GRANT SELECT ON miembros TO contable_app;
GRANT SELECT (id, email, nombre) ON usuarios TO contable_app;

-- empresas, miembros y usuarios: el rol de la app solo ve la empresa en curso y su gente.
-- (Sin FORCE: el registro y la lista de «mis empresas» corren con el usuario de conexión.)
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY empresas_actual ON empresas TO contable_app USING (id = empresa_actual()) WITH CHECK (id = empresa_actual());
ALTER TABLE miembros ENABLE ROW LEVEL SECURITY;
CREATE POLICY miembros_actual ON miembros TO contable_app USING (empresa_id = empresa_actual());
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY usuarios_actual ON usuarios TO contable_app
  USING (EXISTS (SELECT 1 FROM miembros m WHERE m.usuario_id = usuarios.id AND m.empresa_id = empresa_actual()));
