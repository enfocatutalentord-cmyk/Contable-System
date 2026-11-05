-- Bloque 5, entrega 5a (Sistema Empire, «sí» de Patricia del 5-nov-2026): expediente digital del cliente (Documento maestro,
-- sección 5), trámites ante instituciones con su plazo (Fase 2, sección 7) y la lista de pasos de una empresa nueva.

-- ───── Expediente: los archivos van en «documentos» (entidad 'expediente', entidad_id = la empresa) con su carpeta y año ─────
ALTER TABLE documentos ADD COLUMN carpeta text CHECK (carpeta IN ('01', '02', '03', '04', '05', '06')),
                       ADD COLUMN anio int CHECK (anio BETWEEN 1990 AND 2100);
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite'));
-- Además de PDF y fotos, el expediente guarda Word y Excel (contratos, estatutos para firmar, anexos).
ALTER TABLE documentos DROP CONSTRAINT documentos_tipo_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_tipo_check CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
ALTER TABLE documentos ADD CONSTRAINT documentos_expediente_check CHECK (entidad <> 'expediente' OR carpeta IS NOT NULL);
CREATE INDEX documentos_expediente_idx ON documentos(empresa_id, carpeta) WHERE entidad = 'expediente';

-- ───── Trámites (DGII, TSS, Cámara de Comercio, ONAPI u otra) ─────
CREATE TABLE tramites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  institucion text NOT NULL CHECK (institucion IN ('dgii', 'tss', 'camara', 'onapi', 'otra')),
  tipo text NOT NULL CHECK (length(btrim(tipo)) BETWEEN 1 AND 120),
  numero text CHECK (length(numero) <= 60),                       -- número del volante o de la solicitud
  descripcion text CHECK (length(descripcion) <= 1000),
  fecha date NOT NULL,
  plazo date NOT NULL,                                            -- fecha en que deben responder (30 días si el volante no dice)
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  respuesta text CHECK (length(respuesta) <= 1000),
  responsable_id uuid REFERENCES usuarios(id),
  cerrado_por uuid REFERENCES usuarios(id),
  cerrado_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (plazo >= fecha)
);
CREATE INDEX tramites_idx ON tramites(empresa_id, estado, plazo);

-- ───── Empresa nueva: los 9 pasos del manual ─────
ALTER TABLE empresas ADD COLUMN en_constitucion boolean NOT NULL DEFAULT false;
CREATE TABLE pasos_constitucion (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  paso int NOT NULL CHECK (paso BETWEEN 1 AND 9),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'hecho', 'no_aplica')),
  fecha date,
  responsable_id uuid REFERENCES usuarios(id),
  documento_id uuid REFERENCES documentos(id) ON DELETE SET NULL,
  nota text CHECK (length(nota) <= 500),
  PRIMARY KEY (empresa_id, paso)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tramites', 'pasos_constitucion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;
GRANT UPDATE (carpeta, anio) ON documentos TO contable_app;

-- Cualquier documento del expediente se puede enviar por WhatsApp con el enlace seguro.
ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente'));

-- La bitácora anota cada trámite registrado y cerrado.
ALTER TABLE gestiones DROP CONSTRAINT gestiones_origen_check;
ALTER TABLE gestiones ADD CONSTRAINT gestiones_origen_check
  CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion', 'mensaje', 'tramite', 'tramite_cierre'));
CREATE FUNCTION gestion_tramite() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inst text := CASE NEW.institucion WHEN 'dgii' THEN 'DGII' WHEN 'tss' THEN 'TSS' WHEN 'camara' THEN 'Cámara de Comercio' WHEN 'onapi' THEN 'ONAPI' ELSE 'institución' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM anotar_gestion(NEW.empresa_id, NEW.fecha, 'tramite', 'Trámite ante ' || inst || ': ' || NEW.tipo ||
      COALESCE(' (n.º ' || NEW.numero || ')', '') || ', respuesta a más tardar el ' || to_char(NEW.plazo, 'DD/MM/YYYY'), 'tramite', NEW.id);
  ELSIF OLD.estado = 'abierto' AND NEW.estado = 'cerrado' THEN
    PERFORM anotar_gestion(NEW.empresa_id, current_date, 'tramite', 'Trámite ante ' || inst || ' cerrado: ' || NEW.tipo ||
      COALESCE(' · ' || NEW.respuesta, ''), 'tramite_cierre', NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tramites_gestion AFTER INSERT OR UPDATE OF estado ON tramites FOR EACH ROW EXECUTE FUNCTION gestion_tramite();

-- ───── Pestaña nueva «Expediente»: la ven Contador, Auxiliar y Coordinadora (y quien ve todo) ─────
UPDATE perfiles SET pestanas = array_append(pestanas, '/expediente')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Coordinadora') AND pestanas IS NOT NULL AND NOT ('/expediente' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios',
           '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/anticipos', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
