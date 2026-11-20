-- Prioridad 1.6 (cierre): gastos pendientes de pago del presupuesto de Empire («Estado de Pago» del Excel: Pagado / Pendiente).
-- Un gasto pendiente no mueve el presupuesto ni el banco ni la contabilidad; al marcarlo pagado se registra su salida (con su asiento).

CREATE TABLE gastos_pendientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('oficina', 'personal')),
  fecha date NOT NULL,                                    -- cuándo toca pagarlo
  categoria text CHECK (length(btrim(categoria)) BETWEEN 1 AND 80),
  descripcion text CHECK (length(descripcion) <= 300),
  monto numeric(18,2) NOT NULL CHECK (monto > 0),
  cuenta_destino_id uuid NOT NULL REFERENCES cuentas(id), -- el gasto o la cuenta corriente de la socia
  unidad_id uuid REFERENCES unidades_negocio(id),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'descartado')),
  salida_id uuid REFERENCES salidas(id),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'personal' OR categoria IS NOT NULL),
  CHECK (estado <> 'pagado' OR salida_id IS NOT NULL)
);
CREATE INDEX gastos_pendientes_idx ON gastos_pendientes(empresa_id, estado, fecha);

CREATE FUNCTION revisar_gasto_pendiente() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas c WHERE c.id = NEW.cuenta_destino_id AND c.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La cuenta no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unidad_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unidades_negocio u WHERE u.id = NEW.unidad_id AND u.empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'La unidad de negocio no es de esta empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gastos_pendientes_revisar BEFORE INSERT OR UPDATE ON gastos_pendientes FOR EACH ROW EXECUTE FUNCTION revisar_gasto_pendiente();

ALTER TABLE gastos_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos_pendientes FORCE ROW LEVEL SECURITY;
CREATE POLICY gastos_pendientes_empresa ON gastos_pendientes USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON gastos_pendientes TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON gastos_pendientes FOR EACH ROW EXECUTE FUNCTION auditar();
