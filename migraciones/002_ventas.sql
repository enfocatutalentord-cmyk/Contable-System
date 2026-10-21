-- Fase 2: ventas y cuentas por cobrar. Clientes, servicios, secuencias de NCF, facturas,
-- notas de crédito (B04), cobros con retenciones y el asiento automático de cada documento.

-- Cuentas que usan los asientos automáticos. Cada empresa las puede cambiar en Configuración.
CREATE TABLE cuentas_empresa (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  clave text NOT NULL CHECK (clave IN ('cxc', 'itbis_por_pagar', 'ingreso_servicios', 'devoluciones_ventas',
                                       'itbis_retenido_terceros', 'isr_retenido_terceros', 'ganancia_cambiaria', 'perdida_cambiaria')),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  PRIMARY KEY (empresa_id, clave)
);

CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  rnc text CHECK (rnc ~ '^(\d{9}|\d{11})$'),
  email text,
  telefono text,
  direccion text,
  dias_credito int NOT NULL DEFAULT 0 CHECK (dias_credito BETWEEN 0 AND 365),
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clientes_rnc_idx ON clientes(empresa_id, rnc) WHERE rnc IS NOT NULL;

CREATE TABLE servicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  precio numeric(18,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  tasa_itbis numeric(5,2) NOT NULL DEFAULT 18 CHECK (tasa_itbis IN (0, 16, 18)),
  cuenta_ingreso_id uuid REFERENCES cuentas(id),
  activo boolean NOT NULL DEFAULT true
);

-- Rangos de NCF autorizados por la DGII. NCF = tipo (B01…) + 8 dígitos.
CREATE TABLE secuencias_ncf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('B01', 'B02', 'B14', 'B15', 'B04')),
  desde bigint NOT NULL CHECK (desde >= 1),
  hasta bigint NOT NULL CHECK (hasta <= 99999999),
  siguiente bigint NOT NULL,
  vence date NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  creada timestamptz NOT NULL DEFAULT now(),
  CHECK (desde <= hasta AND siguiente BETWEEN desde AND hasta + 1)
);

-- Facturas y notas de crédito comparten tabla (las dos llevan NCF y van al 607).
CREATE TABLE facturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo_ncf text NOT NULL CHECK (tipo_ncf IN ('B01', 'B02', 'B14', 'B15', 'B04')),
  ncf text NOT NULL CHECK (ncf ~ '^B(01|02|04|14|15)\d{8}$'),
  ncf_vence date NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  -- Para notas de crédito: la factura que modifica.
  factura_origen_id uuid REFERENCES facturas(id),
  fecha date NOT NULL,
  vence date NOT NULL,
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  tasa numeric(12,4) NOT NULL DEFAULT 1 CHECK (tasa > 0),
  subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0),
  itbis numeric(18,2) NOT NULL CHECK (itbis >= 0),
  total numeric(18,2) NOT NULL CHECK (total > 0),
  notas text,
  asiento_id uuid REFERENCES asientos(id),
  anulada boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  anulada_por uuid REFERENCES usuarios(id),
  anulada_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, ncf),
  CHECK (total = subtotal + itbis),
  CHECK ((tipo_ncf = 'B04') = (factura_origen_id IS NOT NULL)),
  CHECK (moneda <> 'DOP' OR tasa = 1)
);
CREATE INDEX facturas_cliente_idx ON facturas(empresa_id, cliente_id);
CREATE INDEX facturas_fecha_idx ON facturas(empresa_id, fecha);

CREATE TABLE lineas_factura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id uuid NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  orden int NOT NULL,
  servicio_id uuid REFERENCES servicios(id),
  descripcion text NOT NULL,
  cantidad numeric(14,4) NOT NULL CHECK (cantidad > 0),
  precio numeric(18,2) NOT NULL CHECK (precio >= 0),
  tasa_itbis numeric(5,2) NOT NULL CHECK (tasa_itbis IN (0, 16, 18)),
  cuenta_ingreso_id uuid NOT NULL REFERENCES cuentas(id),
  subtotal numeric(18,2) NOT NULL,
  itbis numeric(18,2) NOT NULL
);
CREATE INDEX lineas_factura_idx ON lineas_factura(factura_id);

CREATE TABLE cobros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  fecha date NOT NULL,
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  tasa numeric(12,4) NOT NULL DEFAULT 1 CHECK (tasa > 0),
  cuenta_destino_id uuid NOT NULL REFERENCES cuentas(id),
  forma_pago text NOT NULL CHECK (forma_pago IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  referencia text,
  -- Lo que entró al banco/caja, más lo que el cliente retuvo y entregó a la DGII a nuestro nombre.
  recibido numeric(18,2) NOT NULL CHECK (recibido >= 0),
  retencion_itbis numeric(18,2) NOT NULL DEFAULT 0 CHECK (retencion_itbis >= 0),
  retencion_isr numeric(18,2) NOT NULL DEFAULT 0 CHECK (retencion_isr >= 0),
  notas text,
  asiento_id uuid REFERENCES asientos(id),
  anulado boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  anulado_por uuid REFERENCES usuarios(id),
  anulado_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CHECK (recibido + retencion_itbis + retencion_isr > 0),
  CHECK (moneda <> 'DOP' OR tasa = 1)
);
CREATE INDEX cobros_cliente_idx ON cobros(empresa_id, cliente_id);

-- Cuánto de cada cobro se aplica a cada factura (en la moneda de la factura).
CREATE TABLE aplicaciones_cobro (
  cobro_id uuid NOT NULL REFERENCES cobros(id) ON DELETE CASCADE,
  factura_id uuid NOT NULL REFERENCES facturas(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  PRIMARY KEY (cobro_id, factura_id)
);
CREATE INDEX aplicaciones_factura_idx ON aplicaciones_cobro(factura_id);

-- Saldo pendiente de cada factura: total - cobros vigentes - notas de crédito vigentes.
CREATE VIEW saldos_factura WITH (security_invoker = true) AS
SELECT f.id AS factura_id,
       f.total
       - COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                    WHERE a.factura_id = f.id AND NOT c.anulado), 0)
       - COALESCE((SELECT sum(n.total) FROM facturas n WHERE n.factura_origen_id = f.id AND NOT n.anulada), 0)
       AS saldo
  FROM facturas f
 WHERE f.tipo_ncf <> 'B04';

-- Los asientos que genera un documento solo se anulan anulando el documento.
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro'));

-- Aislamiento por empresa en todas las tablas nuevas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_empresa', 'clientes', 'servicios', 'secuencias_ncf', 'facturas',
                           'lineas_factura', 'cobros', 'aplicaciones_cobro'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())',
                   t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
  END LOOP;
END $$;
GRANT DELETE ON cuentas_empresa TO contable_app;
GRANT SELECT ON saldos_factura TO contable_app;

-- Configuración de cuentas para las empresas que ya existen, según los códigos del catálogo base.
CREATE FUNCTION configurar_cuentas_empresa(eid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.empresa_id', eid::text, true);
  INSERT INTO cuentas_empresa (empresa_id, clave, cuenta_id)
  SELECT eid, m.clave, c.id
    FROM (VALUES ('cxc', '110201'), ('itbis_por_pagar', '210201'), ('ingreso_servicios', '410101'),
                 ('devoluciones_ventas', '410103'), ('itbis_retenido_terceros', '110404'),
                 ('isr_retenido_terceros', '110403'), ('ganancia_cambiaria', '420102'),
                 ('perdida_cambiaria', '620103')) AS m(clave, codigo)
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
