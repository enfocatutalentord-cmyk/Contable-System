-- Bloque 4, entrega 4b (Sistema Empire, «sí» de Patricia del 5-nov-2026): reporte mensual al cliente (Documento maestro,
-- sección 8). Se arma solo con lo registrado; la coordinadora lo prepara (con notas para el cliente), la socia o la contadora lo
-- revisa, Patricia lo aprueba (las cifras quedan guardadas tal como estaban) y sale por WhatsApp con un enlace al PDF.

CREATE TABLE reportes_mensuales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'revisado', 'aprobado', 'enviado')),
  notas text CHECK (length(notas) <= 3000),           -- comentarios para el cliente
  datos jsonb,                                         -- las cifras al aprobarlo
  huella text,
  preparado_por uuid REFERENCES usuarios(id),
  preparado_en timestamptz,
  revisado_por uuid REFERENCES usuarios(id),
  revisado_en timestamptz,
  aprobado_por uuid REFERENCES usuarios(id),
  aprobado_en timestamptz,
  enviado_en timestamptz,
  UNIQUE (empresa_id, periodo),
  CHECK (estado IN ('borrador', 'revisado') OR (datos IS NOT NULL AND aprobado_por IS NOT NULL))
);
ALTER TABLE reportes_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE reportes_mensuales FORCE ROW LEVEL SECURITY;
CREATE POLICY reportes_mensuales_empresa ON reportes_mensuales USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON reportes_mensuales TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON reportes_mensuales FOR EACH ROW EXECUTE FUNCTION auditar();

-- El reporte se comparte por el enlace seguro de WhatsApp y su envío queda en la bitácora.
ALTER TABLE enlaces_documento DROP CONSTRAINT enlaces_documento_tipo_check;
ALTER TABLE enlaces_documento ADD CONSTRAINT enlaces_documento_tipo_check CHECK (tipo IN ('factura', 'propuesta', 'documento', 'reporte'));
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte'));
