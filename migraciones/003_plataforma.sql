-- Fase 1 (requerimientos del 22-oct-2026): firma contable con cartera de clientes, perfiles con permisos por función,
-- ficha completa de la empresa, estados del asiento (borrador → contabilizado, corrección por reversión),
-- historial de cambios con antes/después y documentos adjuntos.

-- ───────────── Firma contable, perfiles y equipo ─────────────

CREATE TABLE firmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  rnc text CHECK (rnc ~ '^(\d{9}|\d{11})$'),
  creada timestamptz NOT NULL DEFAULT now()
);

-- Permisos por función. Claves usadas por la app (lib/permisos.ts):
-- ver, registrar, contabilizar, revertir, catalogo, cerrar, reabrir, adjuntar, exportar, auditoria, empresa, usuarios.
CREATE TABLE perfiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  permisos text[] NOT NULL DEFAULT '{}',
  sistema boolean NOT NULL DEFAULT false,
  UNIQUE (firma_id, nombre)
);

CREATE TABLE miembros_firma (
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  administrador boolean NOT NULL DEFAULT false,
  creado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firma_id, usuario_id)
);
CREATE INDEX miembros_firma_usuario_idx ON miembros_firma(usuario_id);

CREATE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios'], true),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria'], true),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true),
    (fid, 'Solo lectura', ARRAY['ver','exportar'], true)
  ON CONFLICT (firma_id, nombre) DO NOTHING;
$$;

-- ───────────── Ficha de la empresa ─────────────

ALTER TABLE empresas
  ADD COLUMN firma_id uuid REFERENCES firmas(id),
  ADD COLUMN nombre_comercial text,
  ADD COLUMN tipo_identificacion text NOT NULL DEFAULT 'rnc' CHECK (tipo_identificacion IN ('rnc', 'cedula', 'pasaporte')),
  ADD COLUMN actividad_economica text,
  ADD COLUMN regimen text NOT NULL DEFAULT 'ordinario'
    CHECK (regimen IN ('ordinario', 'rst', 'no_lucrativa', 'zona_franca', 'otro')),
  ADD COLUMN direccion text,
  ADD COLUMN telefono text,
  ADD COLUMN correo text,
  ADD COLUMN mes_cierre int NOT NULL DEFAULT 12 CHECK (mes_cierre BETWEEN 1 AND 12),
  ADD COLUMN inicio_operaciones date,
  -- Si está activo, el auxiliar solo guarda borradores y otra persona con permiso los contabiliza.
  ADD COLUMN requiere_aprobacion boolean NOT NULL DEFAULT false,
  ADD COLUMN activa boolean NOT NULL DEFAULT true;
CREATE INDEX empresas_firma_idx ON empresas(firma_id);

ALTER TABLE miembros ADD COLUMN perfil_id uuid REFERENCES perfiles(id);

-- Datos existentes: cada dueño queda como administrador de una firma con sus empresas; el resto del equipo pasa a la firma
-- con el perfil equivalente a su rol anterior.
DO $$
DECLARE
  d record; fid uuid;
BEGIN
  FOR d IN
    SELECT DISTINCT ON (m.usuario_id) m.usuario_id, u.nombre
      FROM miembros m JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.rol = 'dueno'
     ORDER BY m.usuario_id
  LOOP
    INSERT INTO firmas (nombre) VALUES (d.nombre) RETURNING id INTO fid;
    PERFORM crear_perfiles_firma(fid);
    UPDATE empresas e SET firma_id = fid
     WHERE e.firma_id IS NULL
       AND e.id IN (SELECT empresa_id FROM miembros WHERE usuario_id = d.usuario_id AND rol = 'dueno');
  END LOOP;

  INSERT INTO miembros_firma (firma_id, usuario_id, administrador)
  SELECT e.firma_id, m.usuario_id, bool_or(m.rol = 'dueno')
    FROM miembros m JOIN empresas e ON e.id = m.empresa_id
   WHERE e.firma_id IS NOT NULL
   GROUP BY e.firma_id, m.usuario_id
  ON CONFLICT DO NOTHING;

  UPDATE miembros m SET perfil_id = p.id
    FROM empresas e, perfiles p
   WHERE e.id = m.empresa_id AND p.firma_id = e.firma_id
     AND p.nombre = CASE m.rol WHEN 'dueno' THEN 'Administrador' WHEN 'contador' THEN 'Contador'
                               WHEN 'auxiliar' THEN 'Auxiliar' ELSE 'Solo lectura' END;
END $$;

-- Empresas sin dueño (no debería haber) quedan con una firma propia para no romper la restricción.
DO $$
DECLARE e record; fid uuid;
BEGIN
  FOR e IN SELECT id, nombre FROM empresas WHERE firma_id IS NULL LOOP
    INSERT INTO firmas (nombre) VALUES (e.nombre) RETURNING id INTO fid;
    PERFORM crear_perfiles_firma(fid);
    UPDATE empresas SET firma_id = fid WHERE id = e.id;
  END LOOP;
END $$;
DELETE FROM miembros WHERE perfil_id IS NULL;

ALTER TABLE empresas ALTER COLUMN firma_id SET NOT NULL;
ALTER TABLE miembros ALTER COLUMN perfil_id SET NOT NULL;
ALTER TABLE miembros DROP COLUMN rol;

-- ───────────── Estados del asiento ─────────────
-- borrador: editable, puede no cuadrar, sin número. contabilizado: cuadra, numerado, inmutable; se corrige con un asiento
-- de reversión (revierte_a). anulado: solo lo usan los documentos (factura, cobro) al anularse.

ALTER TABLE asientos
  ADD COLUMN estado text NOT NULL DEFAULT 'contabilizado' CHECK (estado IN ('borrador', 'contabilizado', 'anulado')),
  ADD COLUMN aprobado_por uuid REFERENCES usuarios(id),
  ADD COLUMN aprobado_en timestamptz,
  ADD COLUMN revierte_a uuid UNIQUE REFERENCES asientos(id),
  ADD COLUMN modificado_por uuid REFERENCES usuarios(id),
  ADD COLUMN modificado_en timestamptz;
-- Con FORCE RLS ni el dueño ve filas sin empresa en curso: se suspende solo para pasar los datos existentes.
ALTER TABLE asientos NO FORCE ROW LEVEL SECURITY;
UPDATE asientos SET estado = CASE WHEN anulado THEN 'anulado' ELSE 'contabilizado' END,
                    aprobado_por = creado_por, aprobado_en = creado;
ALTER TABLE asientos FORCE ROW LEVEL SECURITY;
ALTER TABLE asientos ALTER COLUMN estado SET DEFAULT 'borrador';
ALTER TABLE asientos ALTER COLUMN numero DROP NOT NULL;
ALTER TABLE asientos ADD CONSTRAINT asientos_numero_estado CHECK (estado = 'borrador' OR numero IS NOT NULL);
CREATE INDEX asientos_estado_idx ON asientos(empresa_id, estado);

-- `anulado` se mantiene por compatibilidad y sigue al estado.
CREATE FUNCTION sincronizar_estado_asiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anulado AND NEW.estado <> 'anulado' THEN NEW.estado := 'anulado'; END IF;
  NEW.anulado := NEW.estado = 'anulado';
  RETURN NEW;
END $$;
CREATE TRIGGER a_asientos_sincronizar BEFORE INSERT OR UPDATE ON asientos
  FOR EACH ROW EXECUTE FUNCTION sincronizar_estado_asiento();

-- Lo contabilizado no se edita: solo puede pasar a «anulado» (anulación de su documento).
CREATE FUNCTION proteger_asiento_contabilizado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'El asiento está anulado y no se puede modificar' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'contabilizado' THEN
    IF NEW.estado = 'borrador' THEN
      RAISE EXCEPTION 'Un asiento contabilizado no vuelve a borrador; corrígelo con una reversión' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.fecha, NEW.concepto, NEW.referencia, NEW.numero, NEW.origen, NEW.revierte_a, NEW.creado_por, NEW.aprobado_por, NEW.aprobado_en)
       IS DISTINCT FROM
       (OLD.fecha, OLD.concepto, OLD.referencia, OLD.numero, OLD.origen, OLD.revierte_a, OLD.creado_por, OLD.aprobado_por, OLD.aprobado_en) THEN
      RAISE EXCEPTION 'El asiento contabilizado no se puede modificar; corrígelo con una reversión' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER b_asientos_proteger BEFORE UPDATE ON asientos
  FOR EACH ROW EXECUTE FUNCTION proteger_asiento_contabilizado();

-- Las líneas solo se tocan mientras el asiento es borrador (los borrados en cascada del sistema sí pasan).
CREATE FUNCTION proteger_lineas_contabilizadas() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE est text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT estado INTO est FROM asientos WHERE id = COALESCE(NEW.asiento_id, OLD.asiento_id);
  IF est IS NOT NULL AND est <> 'borrador' THEN
    RAISE EXCEPTION 'Las líneas de un asiento contabilizado no se pueden modificar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER lineas_proteger BEFORE INSERT OR UPDATE OR DELETE ON lineas_asiento
  FOR EACH ROW EXECUTE FUNCTION proteger_lineas_contabilizadas();

-- El cuadre se exige al contabilizar (un borrador puede guardarse incompleto).
CREATE OR REPLACE FUNCTION revisar_cuadre() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  aid uuid; est text; d numeric; h numeric; n int;
BEGIN
  -- Cada rama en su propia sentencia: plpgsql no deja nombrar un campo que el registro de esa tabla no tiene.
  IF TG_TABLE_NAME = 'asientos' THEN
    aid := NEW.id;
  ELSE
    aid := COALESCE(NEW.asiento_id, OLD.asiento_id);
  END IF;
  SELECT estado INTO est FROM asientos WHERE id = aid;
  IF est IS NULL OR est = 'borrador' THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(debe), 0), COALESCE(sum(haber), 0), count(*) INTO d, h, n
    FROM lineas_asiento WHERE asiento_id = aid;
  IF n < 2 THEN RAISE EXCEPTION 'El asiento necesita al menos dos líneas' USING ERRCODE = 'check_violation'; END IF;
  IF d <> h THEN RAISE EXCEPTION 'El asiento no cuadra: debe % y haber %', d, h USING ERRCODE = 'check_violation'; END IF;
  IF d = 0 THEN RAISE EXCEPTION 'El asiento no tiene montos' USING ERRCODE = 'check_violation'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER asientos_cuadre AFTER INSERT OR UPDATE ON asientos
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION revisar_cuadre();

-- Solo los borradores se pueden descartar; lo contabilizado se revierte (queda en el historial igualmente).
CREATE OR REPLACE FUNCTION impedir_borrado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'borrador' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Los asientos contabilizados no se borran; se revierten' USING ERRCODE = 'check_violation';
END $$;

GRANT DELETE ON asientos TO contable_app;

-- ───────────── Historial de cambios (antes y después) ─────────────

CREATE TABLE auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id uuid REFERENCES empresas(id) ON DELETE CASCADE,
  tabla text NOT NULL,
  registro_id text,
  padre_id text,
  accion text NOT NULL CHECK (accion IN ('insert', 'update', 'delete')),
  antes jsonb,
  despues jsonb,
  usuario_id uuid REFERENCES usuarios(id),
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_empresa_idx ON auditoria(empresa_id, fecha DESC);
CREATE INDEX auditoria_registro_idx ON auditoria(empresa_id, registro_id);
CREATE INDEX auditoria_padre_idx ON auditoria(empresa_id, padre_id);

-- Se ejecuta con los permisos del dueño de la base para escribir en `auditoria`, que el rol de la app solo puede leer.
CREATE FUNCTION auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a jsonb; d jsonb; fila jsonb; eid uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN a := to_jsonb(OLD) - 'contenido' - 'clave_hash'; END IF;
  IF TG_OP <> 'DELETE' THEN d := to_jsonb(NEW) - 'contenido' - 'clave_hash'; END IF;
  IF TG_OP = 'UPDATE' AND a = d THEN RETURN NULL; END IF;
  fila := COALESCE(d, a);
  eid := CASE WHEN TG_TABLE_NAME = 'empresas' THEN (fila->>'id')::uuid ELSE (fila->>'empresa_id')::uuid END;
  -- Al borrar una empresa completa no se registra cada fila que cae en cascada.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM empresas WHERE id = eid) THEN RETURN NULL; END IF;
  INSERT INTO auditoria (empresa_id, tabla, registro_id, padre_id, accion, antes, despues, usuario_id)
  VALUES (eid, TG_TABLE_NAME, fila->>'id', COALESCE(fila->>'asiento_id', fila->>'factura_id', fila->>'cobro_id'),
          lower(TG_OP), a, d, NULLIF(current_setting('app.usuario_id', true), '')::uuid);
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas', 'cuentas', 'asientos', 'lineas_asiento', 'miembros', 'cuentas_empresa', 'clientes',
                           'servicios', 'secuencias_ncf', 'facturas', 'lineas_factura', 'cobros', 'aplicaciones_cobro'] LOOP
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY auditoria_empresa ON auditoria TO contable_app USING (empresa_id = empresa_actual());
GRANT SELECT ON auditoria TO contable_app;

-- ───────────── Documentos adjuntos ─────────────
-- PDF, JPG y PNG de hasta 4 MB (límite de Vercel por solicitud), guardados en la base con RLS por empresa.
-- No se borran: se marcan como eliminados, con quién y cuándo.

CREATE TABLE documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  entidad text NOT NULL CHECK (entidad IN ('asiento', 'factura', 'cobro')),
  entidad_id uuid NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png')),
  tamano int NOT NULL CHECK (tamano > 0 AND tamano <= 4194304),
  sha256 text NOT NULL,
  contenido bytea NOT NULL,
  descripcion text,
  subido_por uuid NOT NULL REFERENCES usuarios(id),
  subido_en timestamptz NOT NULL DEFAULT now(),
  eliminado boolean NOT NULL DEFAULT false,
  eliminado_por uuid REFERENCES usuarios(id),
  eliminado_en timestamptz
);
CREATE INDEX documentos_entidad_idx ON documentos(empresa_id, entidad, entidad_id);
CREATE UNIQUE INDEX documentos_sin_repetir ON documentos(empresa_id, entidad, entidad_id, sha256) WHERE NOT eliminado;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON documentos FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos FORCE ROW LEVEL SECURITY;
CREATE POLICY documentos_empresa ON documentos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT ON documentos TO contable_app;
GRANT UPDATE (eliminado, eliminado_por, eliminado_en, descripcion) ON documentos TO contable_app;

-- La app ya no usa el rol fijo; el rol de la app lee el perfil para mostrar el equipo.
ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY perfiles_empresa ON perfiles TO contable_app
  USING (firma_id = (SELECT firma_id FROM empresas WHERE id = empresa_actual()));
GRANT SELECT ON perfiles TO contable_app;

-- El rol de la app ve el nombre de las personas del equipo de la firma de la empresa en curso y de quien haya actuado
-- en ella (aunque ya no esté en la firma), para mostrar quién hizo cada cosa.
CREATE INDEX auditoria_usuario_idx ON auditoria(empresa_id, usuario_id);
ALTER TABLE miembros_firma ENABLE ROW LEVEL SECURITY;
CREATE POLICY miembros_firma_actual ON miembros_firma TO contable_app
  USING (firma_id = (SELECT firma_id FROM empresas WHERE id = empresa_actual()));
GRANT SELECT ON miembros_firma TO contable_app;
DROP POLICY usuarios_actual ON usuarios;
CREATE POLICY usuarios_actual ON usuarios TO contable_app USING (
  EXISTS (SELECT 1 FROM miembros_firma mf WHERE mf.usuario_id = usuarios.id)
  OR EXISTS (SELECT 1 FROM auditoria h WHERE h.empresa_id = empresa_actual() AND h.usuario_id = usuarios.id)
  OR EXISTS (SELECT 1 FROM asientos a WHERE a.creado_por = usuarios.id)
);
