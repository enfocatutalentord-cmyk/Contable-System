-- Prioridad 1.6 (parte 2): metas de ahorro y deudas del presupuesto de Empire. Los aportes y los pagos nacen en «Registrar salidas»
-- (cada uno con su asiento); aquí se guarda lo que se quiere lograr y lo que se debe.

-- Metas de ahorro (hoja «Ahorros General»): monto, fecha objetivo y la cuenta de ahorro donde se aparta el dinero.
CREATE TABLE metas_ahorro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  tipo text NOT NULL DEFAULT 'Otro' CHECK (length(btrim(tipo)) BETWEEN 1 AND 40),
  monto_meta numeric(18,2) NOT NULL CHECK (monto_meta > 0),
  fecha_objetivo date,
  cuenta_id uuid REFERENCES cuentas(id),
  activa boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX metas_ahorro_nombre ON metas_ahorro(empresa_id, lower(btrim(nombre)));

-- Deudas (hoja «Deudas General»). «Financiamiento negocio» es un préstamo de Empire: el capital baja el pasivo y los intereses son gasto.
-- Las demás van a la cuenta corriente de la socia.
CREATE TABLE deudas_presupuesto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  acreedor text NOT NULL CHECK (length(btrim(acreedor)) BETWEEN 1 AND 120),
  tipo text NOT NULL CHECK (length(btrim(tipo)) BETWEEN 1 AND 40),
  de_negocio boolean NOT NULL DEFAULT false,
  balance_inicial numeric(18,2) NOT NULL CHECK (balance_inicial >= 0),
  pago_mensual numeric(18,2) NOT NULL DEFAULT 0 CHECK (pago_mensual >= 0),
  cuenta_prestamo_id uuid REFERENCES cuentas(id),
  cuenta_interes_id uuid REFERENCES cuentas(id),
  activa boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT de_negocio OR (cuenta_prestamo_id IS NOT NULL AND cuenta_interes_id IS NOT NULL))
);
CREATE UNIQUE INDEX deudas_presupuesto_nombre ON deudas_presupuesto(empresa_id, lower(btrim(acreedor)));

ALTER TABLE salidas ADD COLUMN meta_id uuid REFERENCES metas_ahorro(id);
ALTER TABLE salidas ADD COLUMN deuda_id uuid REFERENCES deudas_presupuesto(id);
ALTER TABLE salidas ADD COLUMN interes numeric(18,2) NOT NULL DEFAULT 0 CHECK (interes >= 0);
ALTER TABLE salidas ADD CONSTRAINT salidas_interes_monto_check CHECK (interes <= monto AND (interes = 0 OR tipo = 'deuda'));
ALTER TABLE salidas ADD CONSTRAINT salidas_meta_check CHECK (meta_id IS NULL OR tipo = 'ahorro');
ALTER TABLE salidas ADD CONSTRAINT salidas_deuda_check CHECK (deuda_id IS NULL OR tipo = 'deuda');

-- La meta y la deuda de una salida son de la misma empresa.
CREATE OR REPLACE FUNCTION revisar_salida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cuentas c WHERE c.id IN (NEW.cuenta_origen_id, NEW.cuenta_destino_id) AND c.empresa_id <> NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unidad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unidades_negocio u WHERE u.id = NEW.unidad_id AND u.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La unidad de negocio no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.meta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM metas_ahorro m WHERE m.id = NEW.meta_id AND m.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La meta de ahorro no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deuda_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deudas_presupuesto d WHERE d.id = NEW.deuda_id AND d.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La deuda no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Las cuentas de la meta y de la deuda también son de la empresa.
CREATE FUNCTION revisar_cuenta_meta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cuenta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cuentas x WHERE x.id = NEW.cuenta_id AND x.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION revisar_cuentas_deuda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cuentas x WHERE x.id IN (NEW.cuenta_prestamo_id, NEW.cuenta_interes_id) AND x.empresa_id <> NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER metas_ahorro_revisar BEFORE INSERT OR UPDATE ON metas_ahorro FOR EACH ROW EXECUTE FUNCTION revisar_cuenta_meta();
CREATE TRIGGER deudas_presupuesto_revisar BEFORE INSERT OR UPDATE ON deudas_presupuesto FOR EACH ROW EXECUTE FUNCTION revisar_cuentas_deuda();

ALTER TABLE metas_ahorro ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas_ahorro FORCE ROW LEVEL SECURITY;
CREATE POLICY metas_ahorro_empresa ON metas_ahorro USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE deudas_presupuesto ENABLE ROW LEVEL SECURITY;
ALTER TABLE deudas_presupuesto FORCE ROW LEVEL SECURITY;
CREATE POLICY deudas_presupuesto_empresa ON deudas_presupuesto USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON metas_ahorro, deudas_presupuesto TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON metas_ahorro FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON deudas_presupuesto FOR EACH ROW EXECUTE FUNCTION auditar();
