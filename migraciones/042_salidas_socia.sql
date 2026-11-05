-- Bloque 7, entrega 7a: cada salida de dinero a la cuenta que le toca, plantillas de asientos y cuenta de la socia
-- (Documento maestro, sección 3; «sí» de Patricia del 5-nov-2026). Empire no paga sueldo a la socia: lo personal se carga a
-- «Cuenta corriente – <socia>» (activo, cuenta por cobrar) con su categoría, y al cierre del año se liquida contra las
-- ganancias (dividendos con retención de ISR) o queda como cuenta por cobrar.

-- Categoría personal en la línea del asiento (vivienda, alimentación…): sin abrir cuentas nuevas en el catálogo.
ALTER TABLE lineas_asiento ADD COLUMN categoria_personal text CHECK (length(btrim(categoria_personal)) BETWEEN 1 AND 80);

ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco', 'cierre', 'anticipo',
                    'salida', 'liquidacion'));

-- Salidas de dinero: gasto de oficina, gasto personal, pago de deuda personal, ahorro o traspaso entre cuentas.
CREATE TABLE salidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  fecha date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('oficina', 'personal', 'deuda', 'ahorro', 'traspaso')),
  cuenta_origen_id uuid NOT NULL REFERENCES cuentas(id),   -- banco o caja de donde sale
  cuenta_destino_id uuid NOT NULL REFERENCES cuentas(id),  -- gasto, cuenta corriente de la socia, ahorro u otra cuenta
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  categoria text CHECK (length(btrim(categoria)) BETWEEN 1 AND 80),
  acreedor text CHECK (length(btrim(acreedor)) BETWEEN 1 AND 120),
  descripcion text CHECK (length(descripcion) <= 300),
  referencia text CHECK (length(referencia) <= 80),
  unidad_id uuid REFERENCES unidades_negocio(id),
  asiento_id uuid NOT NULL REFERENCES asientos(id),
  anulada boolean NOT NULL DEFAULT false,
  motivo_anulacion text,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  anulada_por uuid REFERENCES usuarios(id),
  anulada_en timestamptz,
  UNIQUE (empresa_id, numero),
  CHECK (cuenta_origen_id <> cuenta_destino_id),
  CHECK (tipo NOT IN ('personal', 'deuda') OR categoria IS NOT NULL),
  CHECK (tipo <> 'deuda' OR acreedor IS NOT NULL)
);
CREATE INDEX salidas_idx ON salidas(empresa_id, fecha DESC);

-- Plantillas de asientos (como las de QuickBooks): sin programar (se usan a mano) o mensuales (preparan un borrador cada mes).
CREATE TABLE plantillas_asiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 100),
  concepto text NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 300),
  referencia text CHECK (length(referencia) <= 80),
  lineas jsonb NOT NULL CHECK (jsonb_typeof(lineas) = 'array'),   -- [{cuentaId, descripcion, debe, haber, unidad}]
  frecuencia text NOT NULL DEFAULT 'ninguna' CHECK (frecuencia IN ('ninguna', 'mensual')),
  dia int CHECK (dia BETWEEN 1 AND 30),                            -- 30 = último día del mes
  proxima date,
  hasta date,
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre),
  CHECK (frecuencia = 'ninguna' OR (dia IS NOT NULL AND proxima IS NOT NULL))
);

-- Los borradores que prepara una plantilla mensual: uno por mes.
ALTER TABLE asientos ADD COLUMN plantilla_id uuid REFERENCES plantillas_asiento(id) ON DELETE SET NULL;
ALTER TABLE asientos ADD COLUMN periodo text CHECK (periodo ~ '^\d{4}-\d{2}$');
CREATE UNIQUE INDEX asientos_plantilla_periodo ON asientos(plantilla_id, periodo) WHERE plantilla_id IS NOT NULL AND estado <> 'anulado';

-- Liquidación de la cuenta corriente de la socia al cierre del ejercicio: dividendos (con su retención de ISR, casilla 5 del
-- IR-17) o la decisión de dejarla como cuenta por cobrar. Una vigente por cuenta y ejercicio.
CREATE TABLE liquidaciones_socia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),
  fin_ejercicio date NOT NULL,
  modo text NOT NULL CHECK (modo IN ('dividendos', 'cuenta_por_cobrar')),
  fecha date NOT NULL,
  saldo numeric(18,2) NOT NULL,          -- saldo de la cuenta corriente al fin del ejercicio
  neto numeric(18,2),                    -- lo que se liquida de la cuenta corriente
  bruto numeric(18,2),                   -- dividendo declarado (neto + retención)
  tasa numeric(7,4),
  retencion numeric(18,2),
  asiento_id uuid REFERENCES asientos(id),
  nota text CHECK (length(nota) <= 500),
  anulada boolean NOT NULL DEFAULT false,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  anulada_por uuid REFERENCES usuarios(id),
  anulada_en timestamptz,
  CHECK (modo = 'cuenta_por_cobrar' OR (neto > 0 AND bruto >= neto AND asiento_id IS NOT NULL))
);
CREATE UNIQUE INDEX liquidaciones_socia_vigente ON liquidaciones_socia(empresa_id, cuenta_id, fin_ejercicio) WHERE NOT anulada;

ALTER TABLE salidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE salidas FORCE ROW LEVEL SECURITY;
CREATE POLICY salidas_empresa ON salidas USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE plantillas_asiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantillas_asiento FORCE ROW LEVEL SECURITY;
CREATE POLICY plantillas_asiento_empresa ON plantillas_asiento USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE liquidaciones_socia ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones_socia FORCE ROW LEVEL SECURITY;
CREATE POLICY liquidaciones_socia_empresa ON liquidaciones_socia USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON salidas, plantillas_asiento, liquidaciones_socia TO contable_app;
GRANT DELETE ON plantillas_asiento TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON salidas FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON plantillas_asiento FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON liquidaciones_socia FOR EACH ROW EXECUTE FUNCTION auditar();

-- Las cuentas y la unidad de una salida o liquidación son de la misma empresa.
CREATE FUNCTION revisar_salida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cuentas c WHERE c.id IN (NEW.cuenta_origen_id, NEW.cuenta_destino_id) AND c.empresa_id <> NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unidad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unidades_negocio u WHERE u.id = NEW.unidad_id AND u.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La unidad de negocio no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salidas_revisar BEFORE INSERT OR UPDATE ON salidas FOR EACH ROW EXECUTE FUNCTION revisar_salida();

CREATE FUNCTION revisar_liquidacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER liquidaciones_socia_revisar BEFORE INSERT OR UPDATE ON liquidaciones_socia FOR EACH ROW EXECUTE FUNCTION revisar_liquidacion();
