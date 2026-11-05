-- Bloque 4, entrega 4c (Sistema Empire, «sí» de Patricia del 5-nov-2026): proyección del cierre fiscal (IR-2 / IR-1) con lo
-- acumulado del ejercicio y alertas fiscales preventivas (Documento maestro, sección 8). La proyección se calcula al momento;
-- al prepararla para el cliente se guarda tal cual, para que el PDF que recibe por WhatsApp no cambie.

CREATE TABLE proyecciones_fiscales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),   -- mes hasta el que se acumula
  datos jsonb NOT NULL,
  notas text CHECK (length(notas) <= 3000),
  preparado_por uuid NOT NULL REFERENCES usuarios(id),
  preparado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, periodo)
);
ALTER TABLE proyecciones_fiscales ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyecciones_fiscales FORCE ROW LEVEL SECURITY;
CREATE POLICY proyecciones_fiscales_empresa ON proyecciones_fiscales USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON proyecciones_fiscales TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON proyecciones_fiscales FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE enlaces_documento DROP CONSTRAINT enlaces_documento_tipo_check;
ALTER TABLE enlaces_documento ADD CONSTRAINT enlaces_documento_tipo_check
  CHECK (tipo IN ('factura', 'propuesta', 'documento', 'reporte', 'proyeccion'));
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion'));
