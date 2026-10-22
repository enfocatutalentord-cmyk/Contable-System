-- Fase 4: compras y cuentas por pagar. Proveedores, facturas de compra (borrador → registrada) con el NCF del proveedor o
-- con un comprobante propio (B11 compras a informales, B13 gastos menores, B17 pagos al exterior), notas de crédito del
-- proveedor, pagos con las retenciones que hacemos, control de NCF duplicados y los datos que pedirá el formato 606.

-- ───────────── Proveedores ─────────────

CREATE TABLE proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo_identificacion text CHECK (tipo_identificacion IN ('rnc', 'cedula', 'pasaporte')),
  rnc text,
  email text,
  telefono text,
  direccion text,
  dias_credito int NOT NULL DEFAULT 0 CHECK (dias_credito BETWEEN 0 AND 365),
  -- Valores habituales para llenar rápido cada compra.
  tipo_gasto text CHECK (tipo_gasto ~ '^(0[1-9]|1[01])$'),
  cuenta_gasto_id uuid REFERENCES cuentas(id),
  retenciones uuid[] NOT NULL DEFAULT '{}',
  del_exterior boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (rnc IS NULL OR (tipo_identificacion = 'rnc' AND rnc ~ '^\d{9}$') OR (tipo_identificacion = 'cedula' AND rnc ~ '^\d{11}$')
         OR (tipo_identificacion = 'pasaporte' AND rnc ~ '^[A-Z0-9]{5,20}$'))
);
CREATE UNIQUE INDEX proveedores_rnc_idx ON proveedores(empresa_id, rnc) WHERE rnc IS NOT NULL;

-- ───────────── Compras ─────────────

CREATE TABLE compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'registrada')),
  -- Comprobante del proveedor (B01, B02, B14, B15, E31…; B04/E34 si es su nota de crédito) o propio (B11, B13, B17).
  tipo_comprobante text NOT NULL CHECK (tipo_comprobante IN ('B01', 'B02', 'B04', 'B11', 'B13', 'B14', 'B15', 'B17',
                                                             'E31', 'E32', 'E34', 'E41', 'E43', 'E44', 'E45', 'E47')),
  ncf text CHECK (ncf ~ ('^' || tipo_comprobante || CASE WHEN tipo_comprobante LIKE 'E%' THEN '\d{10}$' ELSE '\d{8}$' END)),
  ncf_vence date,
  proveedor_id uuid NOT NULL REFERENCES proveedores(id),
  -- Para notas de crédito del proveedor: la compra que modifican.
  compra_origen_id uuid REFERENCES compras(id),
  fecha date NOT NULL,
  vence date NOT NULL,
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  tasa numeric(12,4) NOT NULL DEFAULT 1 CHECK (tasa > 0),
  -- Tipo de bienes y servicios comprados del formato 606 (01 a 11).
  tipo_gasto text NOT NULL CHECK (tipo_gasto ~ '^(0[1-9]|1[01])$'),
  -- ITBIS llevado al costo (sin derecho a crédito: B02, empresa no contribuyente o gasto no deducible).
  itbis_al_costo boolean NOT NULL DEFAULT false,
  subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0),
  itbis numeric(18,2) NOT NULL CHECK (itbis >= 0),
  otros_impuestos numeric(18,2) NOT NULL DEFAULT 0 CHECK (otros_impuestos >= 0),
  total numeric(18,2) NOT NULL CHECK (total > 0),
  notas text,
  asiento_id uuid REFERENCES asientos(id),
  anulada boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  anulada_por uuid REFERENCES usuarios(id),
  anulada_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  registrada_por uuid REFERENCES usuarios(id),
  registrada_en timestamptz,
  modificado_por uuid REFERENCES usuarios(id),
  modificado_en timestamptz,
  CHECK (total = subtotal + itbis + otros_impuestos),
  CHECK ((tipo_comprobante IN ('B04', 'E34')) = (compra_origen_id IS NOT NULL)),
  CHECK (moneda <> 'DOP' OR tasa = 1),
  CHECK (vence >= fecha),
  CONSTRAINT compras_registro_check CHECK (
    (estado = 'registrada' AND ncf IS NOT NULL AND asiento_id IS NOT NULL)
    OR (estado = 'borrador' AND asiento_id IS NULL AND NOT anulada))
);
CREATE INDEX compras_proveedor_idx ON compras(empresa_id, proveedor_id);
CREATE INDEX compras_fecha_idx ON compras(empresa_id, fecha);
-- Control de duplicados: el mismo NCF del mismo proveedor no se registra dos veces (salvo que el anterior esté anulado).
CREATE UNIQUE INDEX compras_ncf_unico ON compras(empresa_id, proveedor_id, ncf) WHERE ncf IS NOT NULL AND NOT anulada;

CREATE TABLE lineas_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  descripcion text NOT NULL,
  -- El 606 separa el monto facturado en servicios y en bienes.
  clase text NOT NULL CHECK (clase IN ('servicio', 'bien')),
  cantidad numeric(14,4) NOT NULL CHECK (cantidad > 0),
  precio numeric(18,2) NOT NULL CHECK (precio >= 0),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  subtotal numeric(18,2) NOT NULL,
  itbis numeric(18,2) NOT NULL,
  otros numeric(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX lineas_compra_idx ON lineas_compra(compra_id);

CREATE TABLE impuestos_linea_compra (
  linea_id uuid NOT NULL REFERENCES lineas_compra(id) ON DELETE CASCADE,
  compra_id uuid NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  impuesto_id uuid NOT NULL REFERENCES impuestos(id),
  tipo text NOT NULL,
  tasa numeric(7,4) NOT NULL,
  monto numeric(18,2) NOT NULL CHECK (monto >= 0),
  PRIMARY KEY (linea_id, impuesto_id)
);
CREATE INDEX impuestos_linea_compra_idx ON impuestos_linea_compra(compra_id);

-- ───────────── Pagos ─────────────

CREATE TABLE pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  proveedor_id uuid NOT NULL REFERENCES proveedores(id),
  fecha date NOT NULL,
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  tasa numeric(12,4) NOT NULL DEFAULT 1 CHECK (tasa > 0),
  cuenta_origen_id uuid NOT NULL REFERENCES cuentas(id),
  -- Forma de pago del formato 606 (01 a 07).
  forma_pago text NOT NULL CHECK (forma_pago IN ('01', '02', '03', '04', '05', '06', '07')),
  referencia text,
  -- Lo que salió del banco o caja; las retenciones las pagamos nosotros a la DGII a nombre del proveedor.
  pagado numeric(18,2) NOT NULL CHECK (pagado >= 0),
  retencion_itbis numeric(18,2) NOT NULL DEFAULT 0 CHECK (retencion_itbis >= 0),
  retencion_isr numeric(18,2) NOT NULL DEFAULT 0 CHECK (retencion_isr >= 0),
  notas text,
  asiento_id uuid NOT NULL REFERENCES asientos(id),
  anulado boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  anulado_por uuid REFERENCES usuarios(id),
  anulado_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CHECK (pagado + retencion_itbis + retencion_isr > 0),
  CHECK (moneda <> 'DOP' OR tasa = 1)
);
CREATE INDEX pagos_proveedor_idx ON pagos(empresa_id, proveedor_id);

CREATE TABLE aplicaciones_pago (
  pago_id uuid NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  compra_id uuid NOT NULL REFERENCES compras(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  PRIMARY KEY (pago_id, compra_id)
);
CREATE INDEX aplicaciones_compra_idx ON aplicaciones_pago(compra_id);

CREATE TABLE retenciones_pago (
  pago_id uuid NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  retencion_id uuid NOT NULL REFERENCES retenciones(id),
  impuesto text NOT NULL CHECK (impuesto IN ('itbis', 'isr')),
  tasa numeric(7,4) NOT NULL,
  codigo_606 smallint,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  PRIMARY KEY (pago_id, retencion_id)
);

-- Saldo pendiente de cada compra registrada: total − pagos vigentes − notas de crédito del proveedor vigentes.
CREATE VIEW saldos_compra WITH (security_invoker = true) AS
SELECT c.id AS compra_id,
       c.total
       - COALESCE((SELECT sum(a.monto) FROM aplicaciones_pago a JOIN pagos p ON p.id = a.pago_id
                    WHERE a.compra_id = c.id AND NOT p.anulado), 0)
       - COALESCE((SELECT sum(n.total) FROM compras n
                    WHERE n.compra_origen_id = c.id AND n.estado = 'registrada' AND NOT n.anulada), 0)
       AS saldo
  FROM compras c
 WHERE c.tipo_comprobante NOT IN ('B04', 'E34') AND c.estado = 'registrada';

-- ───────────── Protección de lo registrado ─────────────

CREATE FUNCTION compras_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' AND EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN
      RAISE EXCEPTION 'Una compra registrada no se borra; se anula' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'registrada' AND (to_jsonb(NEW) - ARRAY['anulada', 'motivo_anulacion', 'anulada_por', 'anulada_en'])
                                 <> (to_jsonb(OLD) - ARRAY['anulada', 'motivo_anulacion', 'anulada_por', 'anulada_en']) THEN
    RAISE EXCEPTION 'Una compra registrada no se modifica; se anula o se corrige con la nota de crédito del proveedor' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.anulada AND NOT NEW.anulada THEN
    RAISE EXCEPTION 'Una compra anulada no se puede reactivar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compras_proteger BEFORE UPDATE OR DELETE ON compras FOR EACH ROW EXECUTE FUNCTION compras_proteger();

CREATE FUNCTION lineas_compra_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.compra_id ELSE NEW.compra_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM compras c JOIN empresas e ON e.id = c.empresa_id WHERE c.id = cid AND c.estado <> 'borrador') THEN
    RAISE EXCEPTION 'Las líneas de una compra registrada no se modifican' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER lineas_compra_proteger BEFORE INSERT OR UPDATE OR DELETE ON lineas_compra
  FOR EACH ROW EXECUTE FUNCTION lineas_compra_proteger();
CREATE TRIGGER impuestos_linea_compra_proteger BEFORE INSERT OR UPDATE OR DELETE ON impuestos_linea_compra
  FOR EACH ROW EXECUTE FUNCTION lineas_compra_proteger();

-- Referencias de la misma empresa.
CREATE TRIGGER proveedores_referencias BEFORE INSERT OR UPDATE ON proveedores FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas.cuenta_gasto_id');
CREATE TRIGGER compras_referencias BEFORE INSERT OR UPDATE ON compras FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('proveedores.proveedor_id', 'compras.compra_origen_id');
CREATE TRIGGER lineas_compra_referencias BEFORE INSERT OR UPDATE ON lineas_compra FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas.cuenta_id');
CREATE TRIGGER impuestos_linea_compra_referencias BEFORE INSERT OR UPDATE ON impuestos_linea_compra FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('impuestos.impuesto_id');
CREATE TRIGGER pagos_referencias BEFORE INSERT OR UPDATE ON pagos FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('proveedores.proveedor_id', 'cuentas.cuenta_origen_id');
CREATE TRIGGER retenciones_pago_referencias BEFORE INSERT OR UPDATE ON retenciones_pago FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('retenciones.retencion_id', 'cuentas.cuenta_id');

-- ───────────── Asientos, cuentas, documentos y auditoría ─────────────

ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago'));

ALTER TABLE cuentas_empresa DROP CONSTRAINT cuentas_empresa_clave_check;
ALTER TABLE cuentas_empresa ADD CONSTRAINT cuentas_empresa_clave_check CHECK (clave IN (
  'cxc', 'itbis_por_pagar', 'ingreso_servicios', 'devoluciones_ventas', 'itbis_retenido_terceros', 'isr_retenido_terceros',
  'ganancia_cambiaria', 'perdida_cambiaria', 'cxp', 'cxp_exterior', 'gasto_general'));

ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago'));

-- El historial agrupa las líneas de una compra o un pago bajo su documento.
CREATE OR REPLACE FUNCTION auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a jsonb; d jsonb; fila jsonb; eid uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN a := to_jsonb(OLD) - 'contenido' - 'clave_hash'; END IF;
  IF TG_OP <> 'DELETE' THEN d := to_jsonb(NEW) - 'contenido' - 'clave_hash'; END IF;
  IF TG_OP = 'UPDATE' AND a = d THEN RETURN NULL; END IF;
  fila := COALESCE(d, a);
  eid := CASE WHEN TG_TABLE_NAME = 'empresas' THEN (fila->>'id')::uuid ELSE (fila->>'empresa_id')::uuid END;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM empresas WHERE id = eid) THEN RETURN NULL; END IF;
  INSERT INTO auditoria (empresa_id, tabla, registro_id, padre_id, accion, antes, despues, usuario_id)
  VALUES (eid, TG_TABLE_NAME, fila->>'id',
          COALESCE(fila->>'asiento_id', fila->>'factura_id', fila->>'cobro_id', fila->>'compra_id', fila->>'pago_id'),
          lower(TG_OP), a, d, NULLIF(current_setting('app.usuario_id', true), '')::uuid);
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proveedores', 'compras', 'lineas_compra', 'impuestos_linea_compra', 'pagos', 'aplicaciones_pago',
                           'retenciones_pago'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())',
                   t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;
GRANT DELETE ON compras, lineas_compra, impuestos_linea_compra TO contable_app;
GRANT SELECT ON saldos_compra TO contable_app;

-- Cuentas de compras para las empresas que ya existen (y para las nuevas, desde configurar_cuentas_empresa).
CREATE OR REPLACE FUNCTION configurar_cuentas_empresa(eid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.empresa_id', eid::text, true);
  INSERT INTO cuentas_empresa (empresa_id, clave, cuenta_id)
  SELECT eid, m.clave, c.id
    FROM (VALUES ('cxc', '110201'), ('ingreso_servicios', '410101'), ('devoluciones_ventas', '410103'),
                 ('ganancia_cambiaria', '420102'), ('perdida_cambiaria', '620103'),
                 ('cxp', '210101'), ('cxp_exterior', '210102'), ('gasto_general', '610214')) AS m(clave, codigo)
    JOIN cuentas c ON c.empresa_id = eid AND c.codigo = m.codigo AND c.de_detalle
  ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM empresas LOOP
    PERFORM configurar_cuentas_empresa(e.id);
  END LOOP;
  PERFORM set_config('app.empresa_id', '', true);
END $$;
