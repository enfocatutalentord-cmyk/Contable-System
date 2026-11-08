-- Entrega 6b.2 (Sistema Empire, «sí» de Patricia del 8-nov-2026 con las respuestas recomendadas): levantamiento contable en línea,
-- con sus anexos y el estado de situación financiera inicial. Usa el mismo motor de formularios de la 6a.

ALTER TABLE formularios DROP CONSTRAINT formularios_tipo_check;
ALTER TABLE formularios ADD CONSTRAINT formularios_tipo_check CHECK (tipo IN ('ficha', 'constitucion', 'solicitud', 'levantamiento'));

-- El estado inicial lo aprueba Patricia antes de usarse o de salir al cliente (regla de oro del manual).
ALTER TABLE formularios ADD COLUMN aprobado_por uuid REFERENCES usuarios(id), ADD COLUMN aprobado_en timestamptz;

CREATE OR REPLACE FUNCTION gestion_formulario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, current_date, 'solicitud',
    CASE NEW.tipo WHEN 'ficha' THEN 'Ficha de Registro' WHEN 'constitucion' THEN 'Formulario de Constitución'
                  WHEN 'levantamiento' THEN 'Levantamiento contable' ELSE 'Solicitud de Servicio' END ||
    ' recibida del cliente por el formulario en línea', 'formulario', NEW.id);
  RETURN NULL;
END $$;

-- Mensaje para enviar el enlace (no estaba en el manual; escrito en el mismo tono, para que Patricia lo revise).
CREATE OR REPLACE FUNCTION crear_plantilla_levantamiento(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'levantamiento_contable', 26, 'Levantamiento contable',
          'Buenos días, [nombre]. Para hacer el diagnóstico contable de su empresa, complete este formulario con sus anexos: [enlace]. Si necesita ayuda para llenarlo, con gusto lo hacemos juntos. -- Empire Tax’N Legal')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantilla_levantamiento(id) FROM firmas;
