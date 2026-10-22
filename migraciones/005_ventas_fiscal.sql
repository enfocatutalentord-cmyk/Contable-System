-- Fase 3: ventas y CxC sobre la plataforma (fase 1) y la configuración tributaria (fase 2).
-- Facturas en borrador → emitidas (como Draft → Approved en Xero), impuestos configurables por línea (varios por línea),
-- retenciones configurables en los cobros, más tipos de comprobante y datos fiscales del cliente.

-- ───────────── Clientes ─────────────

ALTER TABLE clientes
  ADD COLUMN tipo_identificacion text CHECK (tipo_identificacion IN ('rnc', 'cedula', 'pasaporte')),
  ADD COLUMN ncf_predeterminado text CHECK (ncf_predeterminado IN ('B01', 'B02', 'B14', 'B15', 'B16')),
  -- Retenciones que este cliente suele hacer al pagar (se sugieren en el cobro).
  ADD COLUMN retenciones uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE clientes DROP CONSTRAINT clientes_rnc_check;
ALTER TABLE clientes ADD CONSTRAINT clientes_identificacion_check CHECK (
  rnc IS NULL OR (tipo_identificacion = 'rnc' AND rnc ~ '^\d{9}$') OR (tipo_identificacion = 'cedula' AND rnc ~ '^\d{11}$')
  OR (tipo_identificacion = 'pasaporte' AND rnc ~ '^[A-Z0-9]{5,20}$'));

ALTER TABLE clientes NO FORCE ROW LEVEL SECURITY;
UPDATE clientes SET tipo_identificacion = CASE WHEN length(rnc) = 9 THEN 'rnc' ELSE 'cedula' END WHERE rnc IS NOT NULL;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;

-- ───────────── Productos y servicios: impuestos de la configuración ─────────────

ALTER TABLE servicios
  ADD COLUMN impuesto_id uuid REFERENCES impuestos(id),
  ADD COLUMN impuesto_adicional_id uuid REFERENCES impuestos(id);

ALTER TABLE servicios NO FORCE ROW LEVEL SECURITY;
ALTER TABLE impuestos NO FORCE ROW LEVEL SECURITY;
UPDATE servicios s SET impuesto_id = (
  SELECT i.id FROM impuestos i
   WHERE i.empresa_id = s.empresa_id AND i.activo AND i.tasa = s.tasa_itbis AND i.tipo IN ('itbis', 'exento')
   ORDER BY i.vigente_desde DESC LIMIT 1);
ALTER TABLE impuestos FORCE ROW LEVEL SECURITY;
ALTER TABLE servicios FORCE ROW LEVEL SECURITY;
ALTER TABLE servicios DROP COLUMN tasa_itbis;

-- ───────────── Facturas: borrador → emitida ─────────────

ALTER TABLE facturas DROP CONSTRAINT facturas_tipo_ncf_check;
ALTER TABLE facturas DROP CONSTRAINT facturas_ncf_check;
ALTER TABLE facturas DROP CONSTRAINT facturas_check; -- total = subtotal + itbis
ALTER TABLE facturas
  ADD COLUMN estado text NOT NULL DEFAULT 'emitida' CHECK (estado IN ('borrador', 'emitida')),
  ADD COLUMN otros_impuestos numeric(18,2) NOT NULL DEFAULT 0 CHECK (otros_impuestos >= 0),
  ADD COLUMN emitida_por uuid REFERENCES usuarios(id),
  ADD COLUMN emitida_en timestamptz,
  ADD COLUMN modificado_por uuid REFERENCES usuarios(id),
  ADD COLUMN modificado_en timestamptz,
  ALTER COLUMN ncf DROP NOT NULL,
  ALTER COLUMN ncf_vence DROP NOT NULL,
  ADD CONSTRAINT facturas_tipo_ncf_check CHECK (tipo_ncf IN ('B01', 'B02', 'B04', 'B14', 'B15', 'B16')),
  ADD CONSTRAINT facturas_ncf_check CHECK (ncf ~ ('^' || tipo_ncf || '\d{8}$')),
  ADD CONSTRAINT facturas_suma_check CHECK (total = subtotal + itbis + otros_impuestos),
  ADD CONSTRAINT facturas_emision_check CHECK (
    (estado = 'emitida' AND ncf IS NOT NULL AND ncf_vence IS NOT NULL AND asiento_id IS NOT NULL)
    OR (estado = 'borrador' AND ncf IS NULL AND asiento_id IS NULL AND NOT anulada));
ALTER TABLE facturas ALTER COLUMN estado SET DEFAULT 'borrador';

ALTER TABLE lineas_factura DROP CONSTRAINT lineas_factura_tasa_itbis_check;
ALTER TABLE lineas_factura
  ADD COLUMN otros numeric(18,2) NOT NULL DEFAULT 0;

-- Impuestos de cada línea, con la tasa aplicada (lo emitido no cambia aunque luego cambie la configuración).
CREATE TABLE impuestos_linea_factura (
  linea_id uuid NOT NULL REFERENCES lineas_factura(id) ON DELETE CASCADE,
  factura_id uuid NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  impuesto_id uuid NOT NULL REFERENCES impuestos(id),
  tipo text NOT NULL,
  tasa numeric(7,4) NOT NULL,
  monto numeric(18,2) NOT NULL CHECK (monto >= 0),
  PRIMARY KEY (linea_id, impuesto_id)
);
CREATE INDEX impuestos_linea_factura_idx ON impuestos_linea_factura(factura_id);

-- Líneas ya existentes (si las hubiera): su ITBIS pasa a la nueva tabla con el impuesto equivalente.
ALTER TABLE lineas_factura NO FORCE ROW LEVEL SECURITY;
ALTER TABLE impuestos NO FORCE ROW LEVEL SECURITY;
INSERT INTO impuestos_linea_factura (linea_id, factura_id, empresa_id, impuesto_id, tipo, tasa, monto)
SELECT l.id, l.factura_id, l.empresa_id, i.id, i.tipo, l.tasa_itbis, l.itbis
  FROM lineas_factura l
  JOIN LATERAL (SELECT id, tipo FROM impuestos
                 WHERE empresa_id = l.empresa_id AND tasa = l.tasa_itbis AND tipo IN ('itbis', 'exento')
                 ORDER BY vigente_desde DESC LIMIT 1) i ON true;
ALTER TABLE impuestos FORCE ROW LEVEL SECURITY;
ALTER TABLE lineas_factura FORCE ROW LEVEL SECURITY;
ALTER TABLE lineas_factura DROP COLUMN tasa_itbis;

-- El saldo solo cuenta facturas emitidas.
CREATE OR REPLACE VIEW saldos_factura WITH (security_invoker = true) AS
SELECT f.id AS factura_id,
       f.total
       - COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                    WHERE a.factura_id = f.id AND NOT c.anulado), 0)
       - COALESCE((SELECT sum(n.total) FROM facturas n
                    WHERE n.factura_origen_id = f.id AND n.estado = 'emitida' AND NOT n.anulada), 0)
       AS saldo
  FROM facturas f
 WHERE f.tipo_ncf <> 'B04' AND f.estado = 'emitida';

-- Lo emitido no se toca: solo se puede anular. Los borradores se editan y se pueden descartar.
-- Toda factura o nota de crédito nace como borrador con sus líneas y luego se emite (toma NCF y asiento).
CREATE FUNCTION facturas_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Al borrar una empresa completa (cascada) no hay nada que proteger.
    IF OLD.estado <> 'borrador' AND EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN
      RAISE EXCEPTION 'Un comprobante emitido no se borra; se anula' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'emitida' AND (to_jsonb(NEW) - ARRAY['anulada', 'motivo_anulacion', 'anulada_por', 'anulada_en'])
                              <> (to_jsonb(OLD) - ARRAY['anulada', 'motivo_anulacion', 'anulada_por', 'anulada_en']) THEN
    RAISE EXCEPTION 'Un comprobante emitido no se modifica; se anula o se corrige con una nota de crédito' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.anulada AND NOT NEW.anulada THEN
    RAISE EXCEPTION 'Un comprobante anulado no se puede reactivar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facturas_proteger BEFORE UPDATE OR DELETE ON facturas FOR EACH ROW EXECUTE FUNCTION facturas_proteger();

CREATE FUNCTION lineas_factura_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.factura_id ELSE NEW.factura_id END;
BEGIN
  -- Al descartar un borrador las líneas caen en cascada; si la factura ya no existe, no hay nada que proteger.
  IF EXISTS (SELECT 1 FROM facturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = fid AND f.estado <> 'borrador') THEN
    RAISE EXCEPTION 'Las líneas de un comprobante emitido no se modifican' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER lineas_factura_proteger BEFORE INSERT OR UPDATE OR DELETE ON lineas_factura
  FOR EACH ROW EXECUTE FUNCTION lineas_factura_proteger();
CREATE TRIGGER impuestos_linea_factura_proteger BEFORE INSERT OR UPDATE OR DELETE ON impuestos_linea_factura
  FOR EACH ROW EXECUTE FUNCTION lineas_factura_proteger();

-- Impuestos, retenciones y cuentas usados en ventas deben ser de la misma empresa.
CREATE FUNCTION validar_referencias_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  par text; tabla text; col text; ref uuid; dueña uuid;
BEGIN
  FOREACH par IN ARRAY TG_ARGV LOOP
    tabla := split_part(par, '.', 1);
    col := split_part(par, '.', 2);
    ref := (to_jsonb(NEW)->>col)::uuid;
    CONTINUE WHEN ref IS NULL;
    EXECUTE format('SELECT empresa_id FROM %I WHERE id = $1', tabla) INTO dueña USING ref;
    IF dueña IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La referencia no pertenece a esta empresa' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER servicios_referencias BEFORE INSERT OR UPDATE ON servicios FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('impuestos.impuesto_id', 'impuestos.impuesto_adicional_id', 'cuentas.cuenta_ingreso_id');
CREATE TRIGGER impuestos_linea_referencias BEFORE INSERT OR UPDATE ON impuestos_linea_factura FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('impuestos.impuesto_id');
CREATE TRIGGER lineas_factura_referencias BEFORE INSERT OR UPDATE ON lineas_factura FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas.cuenta_ingreso_id', 'servicios.servicio_id');

-- ───────────── Cobros: retenciones de la configuración ─────────────

CREATE TABLE retenciones_cobro (
  cobro_id uuid NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  retencion_id uuid NOT NULL REFERENCES retenciones(id),
  impuesto text NOT NULL CHECK (impuesto IN ('itbis', 'isr')),
  tasa numeric(7,4) NOT NULL,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  PRIMARY KEY (cobro_id, retencion_id)
);
CREATE TRIGGER retenciones_cobro_referencias BEFORE INSERT OR UPDATE ON retenciones_cobro FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('retenciones.retencion_id', 'cuentas.cuenta_id');

-- ───────────── Aislamiento, permisos y auditoría ─────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['impuestos_linea_factura', 'retenciones_cobro'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())',
                   t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;
-- Los borradores de factura (y sus líneas) se pueden reemplazar o descartar.
GRANT DELETE ON facturas, lineas_factura, impuestos_linea_factura TO contable_app;
