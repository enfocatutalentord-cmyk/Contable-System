-- Bloque 2, entrega 2c (Sistema Empire, «sí» de Patricia del 4-nov-2026): propuestas de servicios, anticipos y trueque.
-- Propuesta: precio de lista, descuento a la vista y precio final; requisitos, anticipo, forma de pago y fecha de entrega;
-- aceptada se convierte en factura o en iguala. Anticipo: se cobra antes de facturar a «Anticipos de clientes» (210501) y se
-- aplica a la factura con un cobro desde esa cuenta. Trueque: forma de cobro «permuta»; la cuenta de lo recibido se elige
-- en cada cobro (decisión de Patricia del 4-nov).

-- ───── Propuestas ─────
CREATE TABLE propuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  fecha date NOT NULL,
  valida_hasta date NOT NULL,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'aceptada', 'rechazada')),
  requisitos text,
  anticipo_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (anticipo_pct BETWEEN 0 AND 100),
  forma_pago text,
  entrega date,
  notas text,
  factura_id uuid REFERENCES facturas(id) ON DELETE SET NULL,
  acuerdo_id uuid REFERENCES acuerdos_cliente(id) ON DELETE SET NULL,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CHECK (valida_hasta >= fecha)
);

CREATE TABLE lineas_propuesta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  propuesta_id uuid NOT NULL REFERENCES propuestas(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  servicio_id uuid REFERENCES servicios(id),
  descripcion text NOT NULL CHECK (length(btrim(descripcion)) > 0),
  cantidad numeric(14,4) NOT NULL CHECK (cantidad > 0),
  precio_lista numeric(18,2) NOT NULL CHECK (precio_lista >= 0),
  descuento numeric(18,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  impuesto_id uuid NOT NULL REFERENCES impuestos(id),
  impuesto_adicional_id uuid REFERENCES impuestos(id),
  unidad_id uuid REFERENCES unidades_negocio(id),
  CHECK (descuento <= precio_lista)
);
CREATE INDEX lineas_propuesta_idx ON lineas_propuesta(propuesta_id);

-- Una propuesta aceptada (o con su factura) ya no cambia de líneas.
CREATE FUNCTION lineas_propuesta_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.propuesta_id ELSE NEW.propuesta_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM propuestas p JOIN empresas e ON e.id = p.empresa_id WHERE p.id = pid AND p.estado IN ('aceptada', 'rechazada')) THEN
    RAISE EXCEPTION 'Una propuesta aceptada o rechazada no se modifica' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER lineas_propuesta_proteger BEFORE INSERT OR UPDATE OR DELETE ON lineas_propuesta FOR EACH ROW EXECUTE FUNCTION lineas_propuesta_proteger();
CREATE TRIGGER lineas_propuesta_unidad BEFORE INSERT OR UPDATE OF unidad_id ON lineas_propuesta FOR EACH ROW EXECUTE FUNCTION linea_unidad();

-- ───── Anticipos ─────
CREATE TABLE anticipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  propuesta_id uuid REFERENCES propuestas(id) ON DELETE SET NULL,
  fecha date NOT NULL,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  cuenta_destino_id uuid NOT NULL REFERENCES cuentas(id),
  cuenta_anticipo_id uuid NOT NULL REFERENCES cuentas(id),
  forma_pago text NOT NULL CHECK (forma_pago IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'permuta', 'otro')),
  referencia text,
  notas text,
  asiento_id uuid REFERENCES asientos(id),
  anulado boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  anulado_por uuid REFERENCES usuarios(id),
  anulado_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

-- Aplicar un anticipo a una factura es un cobro desde la cuenta de anticipos: queda en el saldo, el estado de cuenta y el 607.
ALTER TABLE cobros ADD COLUMN anticipo_id uuid REFERENCES anticipos(id);
CREATE INDEX cobros_anticipo_idx ON cobros(anticipo_id) WHERE anticipo_id IS NOT NULL;

-- Trueque: forma de cobro «permuta» (columna Permuta del 607 y casilla 17 del IT-1).
ALTER TABLE cobros DROP CONSTRAINT cobros_forma_pago_check;
ALTER TABLE cobros ADD CONSTRAINT cobros_forma_pago_check CHECK (forma_pago IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'permuta', 'otro'));

ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco', 'cierre', 'anticipo'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['propuestas', 'lineas_propuesta', 'anticipos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- El cliente de la propuesta y del anticipo es de la misma empresa.
CREATE FUNCTION cliente_de_la_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = NEW.cliente_id AND empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El cliente no es de esta empresa' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER propuestas_cliente BEFORE INSERT OR UPDATE OF cliente_id ON propuestas FOR EACH ROW EXECUTE FUNCTION cliente_de_la_empresa();
CREATE TRIGGER anticipos_cliente BEFORE INSERT OR UPDATE OF cliente_id ON anticipos FOR EACH ROW EXECUTE FUNCTION cliente_de_la_empresa();

-- ───── Pestañas «Propuestas» y «Anticipos» en los roles base ─────
UPDATE perfiles SET pestanas = pestanas || ARRAY['/propuestas', '/anticipos']
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Facturación') AND pestanas IS NOT NULL AND NOT ('/propuestas' = ANY (pestanas));
UPDATE perfiles SET pestanas = pestanas || ARRAY['/anticipos']
 WHERE sistema AND nombre = 'Cliente · Consulta' AND pestanas IS NOT NULL AND NOT ('/anticipos' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado',
           '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza',
           '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial',
           '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado',
           '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor', '/balanza', '/estados', '/reportes']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/anticipos', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
