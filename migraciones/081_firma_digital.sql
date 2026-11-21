-- Prioridad 3 · P3e · Firma digital (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas). El cliente firma un PDF desde un enlace seguro, en el
-- celular: lo lee, firma con el dedo y escribe su nombre y su identificación. Queda el PDF firmado con una página de constancia (hora, dirección de internet,
-- huella del documento) en el expediente. Es una FIRMA ELECTRÓNICA SIMPLE con constancia: no es una firma digital con certificado (Ley 126-02).

CREATE TABLE solicitudes_firma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  origen text NOT NULL CHECK (origen IN ('expediente', 'subido', 'propuesta')),
  origen_id uuid,                                          -- el documento del expediente o la propuesta de donde salió
  carpeta text NOT NULL DEFAULT '06' CHECK (carpeta IN ('01', '02', '03', '04', '05', '06')),   -- donde queda la copia firmada en el expediente
  firmante text CHECK (firmante IS NULL OR length(firmante) <= 120),                              -- quién debería firmar (para el mensaje)
  original bytea NOT NULL CHECK (octet_length(original) <= 4194304),                              -- el PDF tal como se manda a firmar (no cambia)
  original_sha text NOT NULL,                                                                     -- su huella SHA-256
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'vista', 'firmada', 'rechazada', 'cancelada')),
  token_hash text UNIQUE,                                  -- solo el hash del enlace; un enlace nuevo reemplaza el anterior
  vence timestamptz,
  vista_en timestamptz,
  firmante_nombre text,
  firmante_tipo_doc text CHECK (firmante_tipo_doc IS NULL OR firmante_tipo_doc IN ('cedula', 'pasaporte')),
  firmante_doc text,
  firma_png bytea CHECK (firma_png IS NULL OR octet_length(firma_png) <= 400000),
  firmado_en timestamptz,
  firmado_ip text,
  firmado_agente text,
  firmado bytea CHECK (firmado IS NULL OR octet_length(firmado) <= 8388608),                      -- el PDF con la constancia
  firmado_sha text,
  documento_firmado_id uuid REFERENCES documentos(id),     -- la copia firmada en el expediente
  rechazo_motivo text CHECK (rechazo_motivo IS NULL OR length(rechazo_motivo) <= 500),
  rechazado_en timestamptz,
  cancelado_por uuid REFERENCES usuarios(id),
  cancelado_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (estado <> 'firmada' OR (firmante_nombre IS NOT NULL AND firmante_doc IS NOT NULL AND firma_png IS NOT NULL AND firmado IS NOT NULL AND firmado_en IS NOT NULL))
);
CREATE INDEX solicitudes_firma_empresa ON solicitudes_firma (empresa_id, creado DESC);

-- Lo que le pasa a cada solicitud, en orden. No se cambia ni se borra. Los archivos grandes no se copian aquí (por eso la solicitud no lleva el historial general).
CREATE TABLE firma_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitud_id uuid NOT NULL REFERENCES solicitudes_firma(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('creada', 'enlace', 'vista', 'firmada', 'rechazada', 'cancelada')),
  detalle text CHECK (detalle IS NULL OR length(detalle) <= 500),
  ip text,
  quien uuid REFERENCES usuarios(id),
  en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firma_eventos_solicitud ON firma_eventos (solicitud_id, id);
CREATE FUNCTION firma_eventos_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'El registro de una firma no se cambia' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN RAISE EXCEPTION 'El registro de una firma no se borra' USING ERRCODE = 'check_violation'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER firma_eventos_proteger BEFORE UPDATE OR DELETE ON firma_eventos FOR EACH ROW EXECUTE FUNCTION firma_eventos_proteger();

-- Una solicitud firmada o rechazada ya no cambia de estado ni de contenido; una pendiente solo avanza.
CREATE FUNCTION solicitudes_firma_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'firmada' AND EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN RAISE EXCEPTION 'Una firma realizada no se borra' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado IN ('firmada', 'rechazada', 'cancelada') AND (NEW.estado <> OLD.estado OR NEW.original IS DISTINCT FROM OLD.original OR NEW.firmado IS DISTINCT FROM OLD.firmado) THEN
    RAISE EXCEPTION 'Esta solicitud de firma ya está cerrada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.original IS DISTINCT FROM OLD.original OR NEW.original_sha IS DISTINCT FROM OLD.original_sha THEN
    RAISE EXCEPTION 'El documento que se manda a firmar no se cambia' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER solicitudes_firma_proteger BEFORE UPDATE OR DELETE ON solicitudes_firma FOR EACH ROW EXECUTE FUNCTION solicitudes_firma_proteger();

-- El enlace se busca por su hash sin sesión (el cliente firma sin cuenta): estas dos tablas llevan RLS pero sin FORCE, así la conexión dueña las lee y escribe
-- desde la página pública; el rol de la aplicación sigue viendo solo lo de su empresa. Sin trigger de historial general para no copiar los archivos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['solicitudes_firma', 'firma_eventos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON solicitudes_firma TO contable_app;
GRANT SELECT, INSERT ON firma_eventos TO contable_app;

-- Lo que pasa con la firma va a la bitácora del cliente.
ALTER TABLE gestiones DROP CONSTRAINT gestiones_origen_check;
ALTER TABLE gestiones ADD CONSTRAINT gestiones_origen_check
  CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion', 'mensaje', 'tramite', 'tramite_cierre', 'formulario', 'solicitud', 'solicitud_entrega', 'correo',
                    'firma', 'firma_rechazo'));
CREATE FUNCTION gestion_firma() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'firmada' AND OLD.estado <> 'firmada' THEN
    PERFORM anotar_gestion(NEW.empresa_id, (NEW.firmado_en AT TIME ZONE 'America/Santo_Domingo')::date, 'documento',
      'Documento firmado por ' || NEW.firmante_nombre || ': ' || NEW.titulo, 'firma', NEW.id);
  ELSIF NEW.estado = 'rechazada' AND OLD.estado <> 'rechazada' THEN
    PERFORM anotar_gestion(NEW.empresa_id, (NEW.rechazado_en AT TIME ZONE 'America/Santo_Domingo')::date, 'documento',
      'Firma rechazada: ' || NEW.titulo || COALESCE(' (' || NEW.rechazo_motivo || ')', ''), 'firma_rechazo', NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER solicitudes_firma_gestion AFTER UPDATE OF estado ON solicitudes_firma FOR EACH ROW EXECUTE FUNCTION gestion_firma();

-- El mensaje de WhatsApp para pedir la firma (Patricia lo revisa y lo edita en Mensajes predeterminados) y el tipo de referencia.
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente', 'formulario', 'diagnostico', 'tramite', 'cita', 'firma'));
CREATE OR REPLACE FUNCTION crear_plantillas_mensaje_extra(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'solicitud_servicio', 25, 'Solicitud de servicio',
          'Buenos días, [nombre]. Para atender su solicitud, complete este formulario con lo que necesita y para cuándo: [enlace]. Con eso le preparamos la cotización. -- Empire Tax & Legal'),
         (fid, 'requisitos_servicio', 26, 'Requisitos del servicio',
          E'Buenos días, [nombre]. Para avanzar con [servicio] necesitamos que nos envíe lo siguiente:\n[requisitos]\nEn cuanto lo tengamos, empezamos. -- Empire Tax & Legal'),
         (fid, 'estado_tramite', 27, 'Estado del trámite',
          'Buenos días, [nombre]. Le contamos cómo va su trámite «[trámite]»: [estado]. [detalle] Cualquier duda, con gusto le atendemos. -- Empire Tax & Legal'),
         (fid, 'firma_documento', 28, 'Firma de documento',
          'Buenos días, [nombre]. Le enviamos «[documento]» para su firma. Puede leerlo y firmarlo desde su celular en este enlace: [enlace]. El enlace vence en 7 días. -- Empire Tax & Legal'),
         (fid, 'correo_factura', 30, 'Correo: envío de factura',
          'Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto], que va adjunta en PDF. Agradecemos remitirnos el comprobante de pago respondiendo este correo.')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje_extra(id) FROM firmas;
