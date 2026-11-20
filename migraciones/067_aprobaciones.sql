-- Prioridad 2.1 (P2a): permisos con aprobación y bandeja «Por aprobar». Lo que hace una persona con un permiso «con aprobación» no
-- queda en firme: espera aquí hasta que alguien con el permiso «aprobar» lo apruebe o lo devuelva con lo que hay que corregir.
-- Cada trabajo (una factura, una compra…) guarda su historial: quién lo pidió, qué se devolvió, cuándo se aprobó y cuántas veces se devolvió.

CREATE TABLE aprobaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('factura', 'compra')),   -- se amplía con cada tipo de trabajo (salida, declaración, reporte…)
  referencia_id uuid NOT NULL,                                -- el borrador que espera
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  detalle text CHECK (length(detalle) <= 500),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'devuelta', 'aprobada')),
  veces_devuelta int NOT NULL DEFAULT 0 CHECK (veces_devuelta >= 0),
  motivo_devolucion text,
  solicitado_por uuid NOT NULL REFERENCES usuarios(id),
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  resuelto_por uuid REFERENCES usuarios(id),
  resuelto_en timestamptz,
  UNIQUE (empresa_id, tipo, referencia_id)
);
CREATE INDEX aprobaciones_estado_idx ON aprobaciones(empresa_id, estado);

CREATE TABLE aprobaciones_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  aprobacion_id uuid NOT NULL REFERENCES aprobaciones(id) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('solicitada', 'devuelta', 'reenviada', 'aprobada')),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  nota text CHECK (length(nota) <= 1000),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aprobaciones_eventos_idx ON aprobaciones_eventos(aprobacion_id, creado);

-- El historial no se cambia ni se borra.
CREATE FUNCTION aprobaciones_eventos_fijos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Solo cae junto con la empresa completa.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'El historial de aprobaciones no se cambia' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER aprobaciones_eventos_fijos BEFORE UPDATE OR DELETE ON aprobaciones_eventos FOR EACH ROW EXECUTE FUNCTION aprobaciones_eventos_fijos();

ALTER TABLE aprobaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprobaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY aprobaciones_empresa ON aprobaciones USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE aprobaciones_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprobaciones_eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY aprobaciones_eventos_empresa ON aprobaciones_eventos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON aprobaciones TO contable_app;
GRANT SELECT, INSERT ON aprobaciones_eventos TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON aprobaciones FOR EACH ROW EXECUTE FUNCTION auditar();
