-- Bloque 6, entrega 6a (Sistema Empire, «sí» de Patricia del 5-nov-2026): formularios en línea (Documento maestro, sección 6) y
-- solicitudes del cliente (Fase 2, sección 4). El cliente llena el formulario desde un enlace seguro, sin cuenta; lo que envía
-- espera revisión y, al aceptarlo, entra a la ficha, al expediente o a la lista de pasos de la empresa nueva.

CREATE TABLE formularios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ficha', 'constitucion', 'solicitud')),
  token_hash text UNIQUE,                   -- se pone al enviar el enlace (por WhatsApp o para copiar); uno nuevo reemplaza al anterior
  vence timestamptz,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'recibido', 'aceptado', 'descartado')),
  respuestas jsonb,
  recibido_en timestamptz,
  revisado_por uuid REFERENCES usuarios(id),
  revisado_en timestamptz,
  aceptadas text[],                          -- secciones que se cargaron
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX formularios_idx ON formularios(empresa_id, estado);

CREATE TABLE solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('formulario', 'whatsapp', 'escrito', 'llamada', 'app')),
  tipo text NOT NULL DEFAULT 'servicio' CHECK (tipo IN ('servicio', 'requerimiento')),
  servicio_id uuid,                          -- servicio de la lista de precios de la empresa propia (otra empresa: sin FK)
  servicio text CHECK (length(servicio) <= 200),
  descripcion text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 2000),
  para_que text CHECK (length(para_que) <= 1000),
  fecha_requerida date,
  prioridad text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),
  estado text NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida', 'cotizada', 'en_proceso', 'entregada', 'descartada')),
  responsable_id uuid REFERENCES usuarios(id),
  propuesta_id uuid,                         -- propuesta en la empresa propia
  propuesta_numero int,
  formulario_id uuid REFERENCES formularios(id) ON DELETE SET NULL,
  creado_por uuid REFERENCES usuarios(id),   -- vacío si la envió el cliente por el formulario
  creado timestamptz NOT NULL DEFAULT now(),
  entregada_en timestamptz
);
CREATE INDEX solicitudes_idx ON solicitudes(empresa_id, estado);

ALTER TABLE formularios ENABLE ROW LEVEL SECURITY;   -- sin FORCE: el enlace se busca por su hash antes de saber la empresa
CREATE POLICY formularios_empresa ON formularios USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes FORCE ROW LEVEL SECURITY;
CREATE POLICY solicitudes_empresa ON solicitudes USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON formularios, solicitudes TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON formularios FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON solicitudes FOR EACH ROW EXECUTE FUNCTION auditar();

-- Los archivos que adjunta el cliente esperan en «documentos» (entidad 'formulario') hasta que se aceptan y pasan al expediente.
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite', 'formulario'));
GRANT UPDATE (entidad, entidad_id) ON documentos TO contable_app;

-- WhatsApp: el enlace del formulario sale con su mensaje.
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente', 'formulario'));

-- Mensaje para la Solicitud de Servicio (no estaba en el manual; escrito en el mismo tono, para que Patricia lo revise).
CREATE OR REPLACE FUNCTION crear_plantillas_mensaje_extra(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'solicitud_servicio', 25, 'Solicitud de servicio',
          'Buenos días, [nombre]. Para atender su solicitud, complete este formulario con lo que necesita y para cuándo: [enlace]. Con eso le preparamos la cotización. -- Empire Tax’N Legal')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje_extra(id) FROM firmas;

-- La bitácora anota cada formulario recibido y cada solicitud (y su entrega).
ALTER TABLE gestiones DROP CONSTRAINT gestiones_origen_check;
ALTER TABLE gestiones ADD CONSTRAINT gestiones_origen_check
  CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion', 'mensaje', 'tramite', 'tramite_cierre', 'formulario', 'solicitud', 'solicitud_entrega'));
CREATE FUNCTION gestion_formulario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, current_date, 'solicitud',
    CASE NEW.tipo WHEN 'ficha' THEN 'Ficha de Registro' WHEN 'constitucion' THEN 'Formulario de Constitución' ELSE 'Solicitud de Servicio' END ||
    ' recibida del cliente por el formulario en línea', 'formulario', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER formularios_gestion AFTER UPDATE OF estado ON formularios FOR EACH ROW
  WHEN (OLD.estado = 'pendiente' AND NEW.estado IN ('recibido', 'aceptado')) EXECUTE FUNCTION gestion_formulario();
CREATE FUNCTION gestion_solicitud() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM anotar_gestion(NEW.empresa_id, current_date, 'solicitud', 'Solicitud: ' || COALESCE(NEW.servicio || ' · ', '') || left(NEW.descripcion, 200) ||
      COALESCE(' (para el ' || to_char(NEW.fecha_requerida, 'DD/MM/YYYY') || ')', ''), 'solicitud', NEW.id);
  ELSIF NEW.estado = 'entregada' AND OLD.estado <> 'entregada' THEN
    PERFORM anotar_gestion(NEW.empresa_id, current_date, 'solicitud', 'Solicitud entregada: ' || COALESCE(NEW.servicio || ' · ', '') || left(NEW.descripcion, 200),
      'solicitud_entrega', NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER solicitudes_gestion AFTER INSERT OR UPDATE OF estado ON solicitudes FOR EACH ROW EXECUTE FUNCTION gestion_solicitud();

-- ───── Pestaña nueva «Solicitudes y formularios»: Contador, Auxiliar, Coordinadora y Facturación (y quien ve todo) ─────
UPDATE perfiles SET pestanas = array_append(pestanas, '/solicitudes')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Coordinadora', 'Facturación') AND pestanas IS NOT NULL AND NOT ('/solicitudes' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios',
           '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/anticipos', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
