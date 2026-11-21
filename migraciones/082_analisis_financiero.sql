-- Prioridad 3 · P3f · Análisis financiero (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas): razones de liquidez, endeudamiento, rentabilidad y
-- actividad calculadas al momento desde los estados del cliente (sus facturas, compras y saldos del balance, o su contabilidad si la lleva). Lo único que se guarda
-- son las observaciones y sugerencias que escribe la firma para cada período, para el informe en PDF con el logo del cliente.

CREATE TABLE analisis_observaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  desde date NOT NULL,
  hasta date NOT NULL,
  -- { "liquidez": {"observaciones": "...", "sugerencias": "..."}, "endeudamiento": {...}, "rentabilidad": {...}, "actividad": {...}, "general": "..." }
  textos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(textos) = 'object' AND length(textos::text) <= 20000),
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (desde <= hasta),
  UNIQUE (empresa_id, desde, hasta)
);

ALTER TABLE analisis_observaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE analisis_observaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY analisis_observaciones_empresa ON analisis_observaciones USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON analisis_observaciones TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON analisis_observaciones FOR EACH ROW EXECUTE FUNCTION auditar();
