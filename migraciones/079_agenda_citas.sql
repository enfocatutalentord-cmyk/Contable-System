-- Prioridad 3 · P3c · Agenda de citas (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas): reuniones con clientes y prospectos, ligadas a su
-- ficha, con hora, lugar o enlace, asistentes del equipo y notas. Se pueden mover y cancelar (no se borran) y se marcan realizadas. El recordatorio sale
-- por WhatsApp con el mensaje predeterminado «Confirmación de cita» (se envía con un clic) y las alertas avisan de las de hoy y mañana.
-- Sin conexión con Google Calendar.

CREATE TABLE citas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  fecha date NOT NULL,
  hora time NOT NULL,                              -- hora de República Dominicana
  duracion_min int NOT NULL DEFAULT 60 CHECK (duracion_min BETWEEN 5 AND 720),
  modalidad text NOT NULL DEFAULT 'presencial' CHECK (modalidad IN ('presencial', 'virtual', 'llamada')),
  lugar text CHECK (lugar IS NULL OR length(lugar) <= 300),   -- dirección o enlace de la reunión
  asistentes uuid[] NOT NULL DEFAULT '{}',          -- personas del equipo que van
  notas text CHECK (notas IS NULL OR length(notas) <= 2000),
  estado text NOT NULL DEFAULT 'programada' CHECK (estado IN ('programada', 'realizada', 'cancelada')),
  motivo_cancelacion text CHECK (motivo_cancelacion IS NULL OR length(motivo_cancelacion) <= 300),
  movida_veces int NOT NULL DEFAULT 0,
  recordatorio_enviado timestamptz,                 -- cuándo se le mandó el recordatorio por WhatsApp
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  modificado_por uuid REFERENCES usuarios(id),
  modificado timestamptz
);
CREATE INDEX citas_empresa_fecha ON citas (empresa_id, fecha, hora);

ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas FORCE ROW LEVEL SECURITY;
CREATE POLICY citas_empresa ON citas USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON citas TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON citas FOR EACH ROW EXECUTE FUNCTION auditar();

-- El recordatorio de una cita queda en la bitácora y en los mensajes enviados como los demás.
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente', 'formulario', 'diagnostico', 'tramite', 'cita'));
