-- Bloque 3, entrega 3a (Sistema Empire, «sí» de Patricia del 4-nov-2026): bitácora de gestiones por cliente, notificaciones de
-- pago (TSS y DGII) y el rol Coordinadora. La bitácora se llena a mano y también sola con lo que hace el sistema (facturas
-- emitidas, declaraciones marcadas como presentadas, documentos del cliente procesados y notificaciones enviadas).

-- ───── Bitácora ─────
CREATE TABLE gestiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fecha date NOT NULL DEFAULT current_date,
  tipo text NOT NULL CHECK (tipo IN ('factura', 'carta', 'declaracion', 'notificacion', 'solicitud', 'tramite', 'llamada', 'mensaje', 'documento', 'otro')),
  descripcion text NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 1000),
  responsable_id uuid REFERENCES usuarios(id),
  entrega date,
  estado text NOT NULL DEFAULT 'hecha' CHECK (estado IN ('pendiente', 'en_proceso', 'hecha')),
  -- Lo que se anota solo: de qué registro salió (para no repetirlo).
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'factura', 'declaracion', 'recepcion', 'notificacion')),
  origen_id uuid,
  creado_por uuid REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gestiones_fecha_idx ON gestiones(empresa_id, fecha DESC);
CREATE UNIQUE INDEX gestiones_origen_idx ON gestiones(empresa_id, origen, origen_id) WHERE origen <> 'manual';

-- ───── Notificaciones de pago ─────
CREATE TABLE notificaciones_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('tss', 'dgii')),
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  concepto text CHECK (length(concepto) <= 200),
  monto numeric(18,2) NOT NULL CHECK (monto >= 0),
  fecha_limite date NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'pagada')),
  enviada_por uuid REFERENCES usuarios(id),
  enviada_en timestamptz,
  pagada_por uuid REFERENCES usuarios(id),
  pagada_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notificaciones_pago_idx ON notificaciones_pago(empresa_id, estado, fecha_limite);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gestiones', 'notificaciones_pago'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- El PDF de la notificación y el soporte de una gestión van en documentos.
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion'));

-- ───── Lo que se anota solo ─────
CREATE FUNCTION anotar_gestion(eid uuid, f date, t text, d text, o text, oid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO gestiones (empresa_id, fecha, tipo, descripcion, responsable_id, estado, origen, origen_id, creado_por)
  VALUES (eid, f, t, left(d, 1000), NULLIF(current_setting('app.usuario_id', true), '')::uuid, 'hecha', o, oid,
          NULLIF(current_setting('app.usuario_id', true), '')::uuid)
  ON CONFLICT (empresa_id, origen, origen_id) WHERE origen <> 'manual' DO NOTHING;
END $$;

CREATE FUNCTION gestion_factura() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cliente text;
BEGIN
  SELECT nombre INTO cliente FROM clientes WHERE id = NEW.cliente_id;
  PERFORM anotar_gestion(NEW.empresa_id, NEW.fecha, 'factura',
    CASE WHEN NEW.tipo_ncf = 'B04' THEN 'Nota de crédito ' ELSE 'Factura ' END || NEW.ncf || ' a ' || COALESCE(cliente, 'cliente') ||
    ' por ' || CASE WHEN NEW.moneda = 'USD' THEN 'US$' ELSE 'RD$' END || to_char(NEW.total, 'FM999,999,999,990.00'), 'factura', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER facturas_gestion AFTER UPDATE OF estado ON facturas FOR EACH ROW
  WHEN (OLD.estado = 'borrador' AND NEW.estado = 'emitida') EXECUTE FUNCTION gestion_factura();

CREATE FUNCTION gestion_declaracion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, (NEW.enviado_en AT TIME ZONE 'America/Santo_Domingo')::date, 'declaracion',
    'Declaración ' || NEW.formato || ' de ' || substr(NEW.periodo, 5, 2) || '/' || substr(NEW.periodo, 1, 4) || ' marcada como presentada' ||
    CASE WHEN NEW.referencia IS NOT NULL AND NEW.referencia <> '' THEN ' (ref. ' || NEW.referencia || ')' ELSE '' END, 'declaracion', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER envios_dgii_gestion AFTER INSERT ON envios_dgii FOR EACH ROW EXECUTE FUNCTION gestion_declaracion();

CREATE FUNCTION gestion_recepcion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, current_date, 'documento', 'Documento del cliente procesado: ' || NEW.nombre, 'recepcion', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER recepciones_gestion AFTER UPDATE OF estado ON recepciones FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM 'procesado' AND NEW.estado = 'procesado') EXECUTE FUNCTION gestion_recepcion();

CREATE FUNCTION gestion_notificacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM anotar_gestion(NEW.empresa_id, current_date, 'notificacion',
    'Notificación de pago ' || upper(NEW.tipo) || ' de ' || substr(NEW.periodo, 5, 2) || '/' || substr(NEW.periodo, 1, 4) ||
    ' por RD$' || to_char(NEW.monto, 'FM999,999,999,990.00') || ' enviada al cliente (vence el ' || to_char(NEW.fecha_limite, 'DD/MM/YYYY') || ')',
    'notificacion', NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER notificaciones_gestion AFTER UPDATE OF estado ON notificaciones_pago FOR EACH ROW
  WHEN (OLD.estado = 'pendiente' AND NEW.estado = 'enviada') EXECUTE FUNCTION gestion_notificacion();

-- ───── Rol Coordinadora (sección 11 del Documento maestro) y pestañas nuevas ─────
-- Digita compras y ventas, lleva la bitácora, las igualas, los cobros y las notificaciones. No aprueba precios (sin Productos y
-- servicios) ni declaraciones (sin el permiso «impuestos»), no cierra períodos ni configura.
UPDATE perfiles SET pestanas = pestanas || ARRAY['/bitacora', '/notificaciones']
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Facturación') AND pestanas IS NOT NULL AND NOT ('/bitacora' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
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

-- La Coordinadora aparece en todas las firmas; los demás roles base no cambian (solo se les sumaron las pestañas de arriba).
INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas)
SELECT id, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
       ARRAY['', '/recepcion', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
             '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']
  FROM firmas
ON CONFLICT (firma_id, nombre) DO NOTHING;
