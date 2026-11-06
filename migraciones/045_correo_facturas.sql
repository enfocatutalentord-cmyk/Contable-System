-- Facturas por correo (documento «Sistema Empire · Fase 2», sección 7; propuesta del 6-nov-2026, entrega A).
-- Cada intento de envío queda guardado: a quién, con qué asunto y texto, si salió o si Gmail lo frenó («no salió»).
-- Lo que sí salió se anota en la bitácora del cliente.

CREATE TABLE correos_enviados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ref_tipo text NOT NULL CHECK (ref_tipo IN ('factura')),
  ref_id uuid NOT NULL,
  para text NOT NULL CHECK (length(btrim(para)) BETWEEN 3 AND 600),
  responder_a text,
  asunto text NOT NULL CHECK (length(btrim(asunto)) BETWEEN 1 AND 200),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 4000),
  estado text NOT NULL CHECK (estado IN ('enviado', 'no_salio')),
  error text,
  enviado_por uuid NOT NULL REFERENCES usuarios(id),
  enviado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX correos_enviados_ref_idx ON correos_enviados(empresa_id, ref_tipo, ref_id, enviado_en DESC);
ALTER TABLE correos_enviados ENABLE ROW LEVEL SECURITY;
ALTER TABLE correos_enviados FORCE ROW LEVEL SECURITY;
CREATE POLICY correos_enviados_empresa ON correos_enviados USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT ON correos_enviados TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON correos_enviados FOR EACH ROW EXECUTE FUNCTION auditar();

-- La bitácora anota cada correo que salió.
ALTER TABLE gestiones DROP CONSTRAINT gestiones_origen_check;
ALTER TABLE gestiones ADD CONSTRAINT gestiones_origen_check
  CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion', 'mensaje', 'tramite', 'tramite_cierre', 'formulario',
                    'solicitud', 'solicitud_entrega', 'correo'));
CREATE FUNCTION gestion_correo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, (NEW.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date, 'mensaje',
    'Correo: ' || left(NEW.asunto, 150) || ' (a ' || left(NEW.para, 200) || ')', 'correo', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER correos_enviados_gestion AFTER INSERT ON correos_enviados FOR EACH ROW
  WHEN (NEW.estado = 'enviado') EXECUTE FUNCTION gestion_correo();

-- Texto predeterminado del correo de la factura (se edita en Mensajes predeterminados, como los de WhatsApp).
-- Escrito en el mismo tono que «Envío de factura», para que Patricia lo revise.
CREATE OR REPLACE FUNCTION crear_plantillas_mensaje_extra(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'solicitud_servicio', 25, 'Solicitud de servicio',
          'Buenos días, [nombre]. Para atender su solicitud, complete este formulario con lo que necesita y para cuándo: [enlace]. Con eso le preparamos la cotización. -- Empire Tax’N Legal'),
         (fid, 'correo_factura', 30, 'Correo: envío de factura',
          'Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto], que va adjunta en PDF. Agradecemos remitirnos el comprobante de pago respondiendo este correo.')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje_extra(id) FROM firmas;
