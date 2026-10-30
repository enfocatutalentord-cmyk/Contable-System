-- Fase 5, parte 2 (30-oct-2026): conciliación bancaria con sugerencias y reglas, como Xero («match», «create» y
-- «bank rules») y QuickBooks Online («match» y «add»). Cada movimiento del banco se concilia con una o varias líneas de
-- asiento de la cuenta contable del banco (las de cobros, pagos y asientos), o se registra desde el propio movimiento un
-- asiento contra otra cuenta (comisiones, impuesto a las transferencias, transferencias entre cuentas propias). Las reglas
-- solo sugieren: una persona confirma.

ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco'));

ALTER TABLE movimientos_banco
  ADD COLUMN motivo_exclusion text,
  ADD COLUMN conciliado_por uuid REFERENCES usuarios(id),
  ADD COLUMN conciliado_en timestamptz;
GRANT UPDATE (estado, motivo_exclusion, conciliado_por, conciliado_en) ON movimientos_banco TO contable_app;

-- Qué líneas de asiento explican cada movimiento. «monto» va en la moneda de la cuenta bancaria y con el signo del
-- movimiento; la suma tiene que dar el monto del movimiento. Una línea se concilia una sola vez.
CREATE TABLE conciliaciones_banco (
  movimiento_id uuid NOT NULL REFERENCES movimientos_banco(id) ON DELETE CASCADE,
  linea_id uuid NOT NULL UNIQUE REFERENCES lineas_asiento(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  monto numeric(18,2) NOT NULL CHECK (monto <> 0),
  PRIMARY KEY (movimiento_id, linea_id)
);
CREATE INDEX conciliaciones_banco_linea_idx ON conciliaciones_banco(linea_id);

-- La línea tiene que ser de la cuenta contable del banco, de un asiento contabilizado; y nada se concilia ni se
-- desconcilia en un período cerrado.
CREATE FUNCTION conciliacion_valida() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mov movimientos_banco; bloqueo date; cuenta uuid; est text;
BEGIN
  SELECT * INTO mov FROM movimientos_banco WHERE id = COALESCE(NEW.movimiento_id, OLD.movimiento_id);
  IF mov.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF; -- borrado en cascada del movimiento
  SELECT fecha_bloqueo INTO bloqueo FROM empresas WHERE id = mov.empresa_id;
  IF bloqueo IS NOT NULL AND mov.fecha <= bloqueo THEN
    RAISE EXCEPTION 'El período está cerrado hasta el %: no se puede conciliar ni desconciliar ese movimiento', to_char(bloqueo, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.empresa_id <> mov.empresa_id THEN
    RAISE EXCEPTION 'La referencia no pertenece a esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  SELECT l.cuenta_id, a.estado INTO cuenta, est FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
   WHERE l.id = NEW.linea_id AND l.empresa_id = mov.empresa_id;
  IF cuenta IS DISTINCT FROM (SELECT cuenta_id FROM cuentas_bancarias WHERE id = mov.cuenta_bancaria_id) THEN
    RAISE EXCEPTION 'La línea no es de la cuenta contable de este banco' USING ERRCODE = 'check_violation';
  END IF;
  IF est <> 'contabilizado' THEN
    RAISE EXCEPTION 'Solo se concilia con asientos contabilizados' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conciliaciones_banco_valida BEFORE INSERT OR DELETE ON conciliaciones_banco FOR EACH ROW
  EXECUTE FUNCTION conciliacion_valida();

-- Un cobro, pago o asiento conciliado no se anula: primero se desconcilia (como en Xero, «unreconcile» antes de anular).
CREATE FUNCTION asiento_conciliado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'anulado' AND OLD.estado <> 'anulado' AND EXISTS (
       SELECT 1 FROM conciliaciones_banco c JOIN lineas_asiento l ON l.id = c.linea_id WHERE l.asiento_id = NEW.id) THEN
    RAISE EXCEPTION 'Está conciliado con un movimiento del banco: desconcílialo en Bancos antes de anularlo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER c_asientos_conciliados BEFORE UPDATE OF estado, anulado ON asientos FOR EACH ROW EXECUTE FUNCTION asiento_conciliado();

-- Reglas: si la descripción del movimiento contiene alguno de los textos (separados por coma), en la dirección y el rango
-- de monto indicados, se sugiere registrarlo en la cuenta de la regla. Nunca se aplican solas.
CREATE TABLE reglas_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id uuid REFERENCES cuentas_bancarias(id) ON DELETE CASCADE, -- NULL = todas las cuentas
  nombre text NOT NULL,
  textos text NOT NULL,
  direccion text NOT NULL DEFAULT 'sale' CHECK (direccion IN ('entra', 'sale', 'ambas')),
  monto_desde numeric(18,2) CHECK (monto_desde >= 0),
  monto_hasta numeric(18,2) CHECK (monto_hasta >= 0),
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  concepto text NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (monto_hasta IS NULL OR monto_desde IS NULL OR monto_hasta >= monto_desde)
);
CREATE TRIGGER reglas_banco_referencias BEFORE INSERT OR UPDATE ON reglas_banco FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas.cuenta_id', 'cuentas_bancarias.cuenta_bancaria_id');

ALTER TABLE conciliaciones_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliaciones_banco FORCE ROW LEVEL SECURITY;
CREATE POLICY conciliaciones_banco_empresa ON conciliaciones_banco USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE reglas_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE reglas_banco FORCE ROW LEVEL SECURITY;
CREATE POLICY reglas_banco_empresa ON reglas_banco USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

GRANT SELECT, INSERT, DELETE ON conciliaciones_banco TO contable_app;
GRANT SELECT, INSERT, DELETE ON reglas_banco TO contable_app;
GRANT UPDATE (nombre, textos, direccion, monto_desde, monto_hasta, cuenta_id, concepto, activa, cuenta_bancaria_id) ON reglas_banco TO contable_app;

CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON conciliaciones_banco FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON reglas_banco FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER UPDATE OF estado ON movimientos_banco FOR EACH ROW EXECUTE FUNCTION auditar();

-- Al borrar una empresa completa, sus movimientos caen en cascada aunque estén conciliados.
CREATE OR REPLACE FUNCTION movimientos_banco_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bloqueo date;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN RETURN OLD; END IF;
  SELECT fecha_bloqueo INTO bloqueo FROM empresas WHERE id = COALESCE(NEW.empresa_id, OLD.empresa_id);
  IF bloqueo IS NOT NULL AND COALESCE(NEW.fecha, OLD.fecha) <= bloqueo THEN
    RAISE EXCEPTION 'El período está cerrado hasta el %: no se pueden importar ni quitar movimientos de esa fecha', to_char(bloqueo, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'conciliado' THEN
      RAISE EXCEPTION 'El movimiento ya está conciliado' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
