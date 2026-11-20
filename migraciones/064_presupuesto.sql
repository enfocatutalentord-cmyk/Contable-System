-- Prioridad 1.6 del prompt de Patricia (20-nov-2026): el presupuesto de Empire (formato «Presupuesto_Empire_12_meses.xlsx»).
-- Lo que se gasta ya nace en «Registrar salidas» (con su asiento); aquí van las listas de categorías y lo presupuestado por mes.

-- Categorías editables (la hoja «Configuración» del Excel): gasto de oficina y gasto personal.
CREATE TABLE presupuesto_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  lista text NOT NULL CHECK (lista IN ('oficina', 'personal')),
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  orden int NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX presupuesto_categorias_nombre ON presupuesto_categorias(empresa_id, lista, lower(btrim(nombre)));

-- Lo presupuestado por año, mes y categoría. «ahorro» y «deuda» llevan un solo renglón por mes («Total»): lo comprometido.
CREATE TABLE presupuesto_montos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  anio int NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  mes int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  lista text NOT NULL CHECK (lista IN ('oficina', 'personal', 'ahorro', 'deuda')),
  categoria text NOT NULL CHECK (length(btrim(categoria)) BETWEEN 1 AND 80),
  monto numeric(18,2) NOT NULL CHECK (monto >= 0),
  UNIQUE (empresa_id, anio, mes, lista, categoria)
);

ALTER TABLE presupuesto_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto_categorias FORCE ROW LEVEL SECURITY;
CREATE POLICY presupuesto_categorias_empresa ON presupuesto_categorias USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE presupuesto_montos ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto_montos FORCE ROW LEVEL SECURITY;
CREATE POLICY presupuesto_montos_empresa ON presupuesto_montos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON presupuesto_categorias TO contable_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON presupuesto_montos TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON presupuesto_categorias FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON presupuesto_montos FOR EACH ROW EXECUTE FUNCTION auditar();
