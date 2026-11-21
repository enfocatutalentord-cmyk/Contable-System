-- Prioridad 2.2 (P2e, 20-nov-2026), entrega 1: el pago de cada impuesto del cliente con su comprobante y, si Empire lo adelantó, un cargo en las cuentas
-- por cobrar de Empire, sin comprobante fiscal, que se cobra después con su recibo.

-- Cómo se pagó la notificación: quién la pagó, cuándo, con qué referencia y el comprobante (documento de la entidad 'pago_impuesto').
ALTER TABLE notificaciones_pago
  ADD COLUMN pago_quien text CHECK (pago_quien IN ('cliente', 'empire')),
  ADD COLUMN pago_fecha date,
  ADD COLUMN pago_referencia text CHECK (pago_referencia IS NULL OR length(pago_referencia) <= 100),
  ADD COLUMN cargo_id uuid;   -- cargo en la empresa propia cuando Empire adelantó el pago (no lleva llave foránea: vive en otra empresa)

ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite', 'formulario', 'factura_subida', 'pago_impuesto'));

ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco', 'cierre', 'anticipo', 'salida', 'liquidacion', 'vendario', 'cargo'));

-- Cargos a clientes (empresa propia): impuestos que Empire pagó por cuenta del cliente. No llevan NCF; se cobran con un recibo propio.
CREATE TABLE cargos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  concepto text NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 300),
  fecha date NOT NULL,
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  cuenta_pago_id uuid NOT NULL REFERENCES cuentas(id),      -- el banco o caja de donde salió el dinero
  cuenta_cargo_id uuid NOT NULL REFERENCES cuentas(id),     -- «Impuestos pagados por cuenta de clientes»
  asiento_id uuid NOT NULL REFERENCES asientos(id),
  notificacion_id uuid,                                      -- la notificación del cliente que se pagó
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'cobrado')),
  cobrado_en date,
  cobro_forma text,
  cobro_referencia text CHECK (cobro_referencia IS NULL OR length(cobro_referencia) <= 100),
  cuenta_cobro_id uuid REFERENCES cuentas(id),
  asiento_cobro_id uuid REFERENCES asientos(id),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CHECK ((estado = 'cobrado') = (cobrado_en IS NOT NULL))
);
CREATE INDEX cargos_cliente_idx ON cargos_cliente(empresa_id, estado, fecha);

ALTER TABLE cargos_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargos_cliente FORCE ROW LEVEL SECURITY;
CREATE POLICY cargos_cliente_empresa ON cargos_cliente USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON cargos_cliente TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON cargos_cliente FOR EACH ROW EXECUTE FUNCTION auditar();
