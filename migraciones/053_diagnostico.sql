-- Entrega 6b.3 (Sistema Empire, «sí» de Patricia del 8-nov-2026): informe de diagnóstico y propuesta económica del levantamiento.

ALTER TABLE formularios
  ADD COLUMN diagnostico jsonb,
  ADD COLUMN diagnostico_aprobado_por uuid REFERENCES usuarios(id),
  ADD COLUMN diagnostico_aprobado_en timestamptz,
  ADD COLUMN propuesta_servicios_id uuid,   -- propuestas en la empresa propia (otra empresa: sin FK)
  ADD COLUMN propuesta_servicios_numero int,
  ADD COLUMN propuesta_iguala_id uuid,
  ADD COLUMN propuesta_iguala_numero int;

-- WhatsApp y enlace seguro de 30 días para el informe.
ALTER TABLE enlaces_documento DROP CONSTRAINT enlaces_documento_tipo_check;
ALTER TABLE enlaces_documento ADD CONSTRAINT enlaces_documento_tipo_check CHECK (tipo IN ('factura', 'propuesta', 'documento', 'reporte', 'proyeccion', 'diagnostico'));
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente', 'formulario', 'diagnostico'));

-- Mensaje del informe (no estaba en el manual; escrito en el mismo tono, para que Patricia lo revise).
CREATE OR REPLACE FUNCTION crear_plantilla_levantamiento(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto) VALUES
    (fid, 'levantamiento_contable', 26, 'Levantamiento contable',
     'Buenos días, [nombre]. Para hacer el diagnóstico contable de su empresa, complete este formulario con sus anexos: [enlace]. Si necesita ayuda para llenarlo, con gusto lo hacemos juntos. -- Empire Tax’N Legal'),
    (fid, 'diagnostico', 27, 'Informe de diagnóstico',
     'Buenos días, [nombre]. Le compartimos el informe de diagnóstico de [empresa] con nuestras recomendaciones y la propuesta económica: [enlace]. Quedamos a su disposición para revisarlo juntos. -- Empire Tax’N Legal')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantilla_levantamiento(id) FROM firmas;
