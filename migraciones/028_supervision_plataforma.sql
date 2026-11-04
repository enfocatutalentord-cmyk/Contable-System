-- Consola de la plataforma, entrega 2 (4-nov-2026): supervisión de una firma en solo lectura, solo con su permiso.
-- Un administrador de la firma la permite por 24 horas, 7 días o hasta quitarla (como el acceso temporal de Zendesk);
-- la dueña de la plataforma entra con un motivo y cada entrada dura una hora. Todo va al registro, que la firma ve.

CREATE TABLE permisos_supervision (
  firma_id uuid PRIMARY KEY REFERENCES firmas(id) ON DELETE CASCADE,
  hasta timestamptz,                -- NULL = hasta que la firma lo quite
  otorgado_por uuid NOT NULL REFERENCES usuarios(id),
  otorgado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supervisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (length(motivo) >= 5),
  inicio timestamptz NOT NULL DEFAULT now(),
  expira timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  terminada_en timestamptz
);
CREATE INDEX supervisiones_vigentes_idx ON supervisiones(usuario_id, firma_id, expira);

ALTER TABLE registro_plataforma DROP CONSTRAINT registro_plataforma_accion_check;
ALTER TABLE registro_plataforma ADD CONSTRAINT registro_plataforma_accion_check
  CHECK (accion IN ('ver_firma', 'suspender', 'reactivar', 'permiso_dado', 'permiso_quitado', 'supervisar', 'terminar_supervision'));
