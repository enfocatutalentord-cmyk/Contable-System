-- Rediseño R5 (Lista de rediseños de Patricia, 6-nov-2026, n.º 10): los estados financieros de un cliente sin contabilidad se arman
-- con sus facturas emitidas y sus compras registradas (ingresos, costos y gastos) más un formulario con los saldos que las facturas no
-- traen (efectivo, cuentas por cobrar y por pagar, activos, préstamos y capital). Nada se borra.

-- ¿La empresa en curso lleva contabilidad con asientos? La empresa propia de la firma siempre; un cliente, si lo tiene marcado.
-- SECURITY DEFINER: el rol de la aplicación no lee la tabla de firmas.
CREATE OR REPLACE FUNCTION empresa_lleva_contabilidad() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT e.lleva_contabilidad OR e.id IS NOT DISTINCT FROM f.empresa_propia_id
                     FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.id = empresa_actual()), true);
$$;
GRANT EXECUTE ON FUNCTION empresa_lleva_contabilidad() TO contable_app;

-- Saldos del balance a una fecha de corte (por año o por mes). «montos» guarda cada concepto en positivo, como lo escribe la persona.
CREATE TABLE saldos_registro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  montos jsonb NOT NULL DEFAULT '{}'::jsonb,
  notas text,
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, fecha)
);
ALTER TABLE saldos_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_registro FORCE ROW LEVEL SECURITY;
CREATE POLICY saldos_registro_empresa ON saldos_registro USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON saldos_registro TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON saldos_registro FOR EACH ROW EXECUTE FUNCTION auditar();
