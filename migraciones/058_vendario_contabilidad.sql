-- Integración con Vendario, parte 2: cada evento contable se convierte en su asiento (con el «entry» de Vendario pasado a las cuentas de
-- cada cliente) y en los documentos que necesitan el 606, 607, 608 e IT-1 (facturas, notas, cobros, compras y pagos).

-- Asientos que vienen de Vendario.
ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check CHECK (origen IN
  ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco', 'cierre', 'anticipo', 'salida', 'liquidacion', 'vendario'));

-- Cuenta neutral del acuerdo (CAJA, VENTAS, GASTO:<categoría>…) → cuenta del catálogo de cada cliente. La confirma el contable.
CREATE TABLE vendario_mapeo (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta text NOT NULL CHECK (length(cuenta) BETWEEN 2 AND 120),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, cuenta)
);
ALTER TABLE vendario_mapeo ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendario_mapeo FORCE ROW LEVEL SECURITY;
CREATE POLICY vendario_mapeo_empresa ON vendario_mapeo USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON vendario_mapeo TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON vendario_mapeo FOR EACH ROW EXECUTE FUNCTION auditar();

-- Ventas hechas en Vendario sin comprobante fiscal: no van al 607, pero sí al IT-1 («otras operaciones», casilla 9 del Anexo A).
CREATE TABLE ventas_sin_comprobante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  vendario_evento_id uuid NOT NULL UNIQUE,
  fecha date NOT NULL,
  subtotal numeric(18,2) NOT NULL,
  itbis numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL,
  gravado jsonb NOT NULL DEFAULT '{}',           -- base por tasa de ITBIS: {"18": "1000.00"}
  exento numeric(18,2) NOT NULL DEFAULT 0,
  formas jsonb NOT NULL DEFAULT '{}',            -- cobrado por forma: {"efectivo": "1180.00"}; lo demás, a crédito
  asiento_id uuid REFERENCES asientos(id),
  anulada boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ventas_sin_comprobante_fecha ON ventas_sin_comprobante (empresa_id, fecha);
ALTER TABLE ventas_sin_comprobante ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_sin_comprobante FORCE ROW LEVEL SECURITY;
CREATE POLICY ventas_sin_comprobante_empresa ON ventas_sin_comprobante USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON ventas_sin_comprobante TO contable_app;

-- Documentos que nacieron de un evento de Vendario: no se anulan a mano en Empire (se anulan cuando Vendario manda la anulación).
ALTER TABLE facturas ADD COLUMN vendario_evento_id uuid;
ALTER TABLE compras ADD COLUMN vendario_evento_id uuid;
ALTER TABLE cobros ADD COLUMN vendario_evento_id uuid;
ALTER TABLE pagos ADD COLUMN vendario_evento_id uuid;

-- Lo que se creó con cada evento.
ALTER TABLE vendario_eventos
  ADD COLUMN empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  ADD COLUMN asiento_id uuid REFERENCES asientos(id),
  ADD COLUMN factura_id uuid REFERENCES facturas(id),
  ADD COLUMN compra_id uuid REFERENCES compras(id),
  ADD COLUMN cobro_id uuid REFERENCES cobros(id),
  ADD COLUMN pago_id uuid REFERENCES pagos(id),
  ADD COLUMN venta_sin_comprobante_id uuid REFERENCES ventas_sin_comprobante(id),
  ADD COLUMN intentos int NOT NULL DEFAULT 0;
CREATE INDEX vendario_eventos_por_procesar ON vendario_eventos (vendario_cliente_id, seq) WHERE estado IN ('esperando', 'pendiente');
