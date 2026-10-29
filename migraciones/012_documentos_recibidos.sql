-- Documentos recibidos (parte 3 de la nueva navegación, aprobada por Joannie el 28-oct-2026): lo que suben los clientes
-- (fotos de gastos, facturas recibidas, estados bancarios, contratos) llega a una bandeja para que el equipo lo procese,
-- como la captura de recibos de QuickBooks Online y Hubdoc en Xero. Al procesarlo se puede convertir en una compra:
-- el archivo pasa a ser su documento de soporte.
CREATE TABLE recepciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN ('gasto', 'factura_recibida', 'estado_bancario', 'contrato', 'otro')),
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png')),
  tamano int NOT NULL CHECK (tamano > 0 AND tamano <= 4194304),
  sha256 text NOT NULL,
  contenido bytea NOT NULL,
  nota text,                                        -- lo que escribe quien lo sube
  subido_por uuid NOT NULL REFERENCES usuarios(id),
  subido_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo', 'en_proceso', 'procesado', 'descartado')),
  respuesta text,                                   -- lo que le contesta el equipo
  procesado_por uuid REFERENCES usuarios(id),
  procesado_en timestamptz,
  compra_id uuid REFERENCES compras(id)
);
CREATE INDEX recepciones_bandeja_idx ON recepciones(empresa_id, estado, subido_en DESC);
CREATE UNIQUE INDEX recepciones_sin_repetir ON recepciones(empresa_id, sha256) WHERE estado <> 'descartado';
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON recepciones FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE recepciones FORCE ROW LEVEL SECURITY;
CREATE POLICY recepciones_empresa ON recepciones USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT ON recepciones TO contable_app;
GRANT UPDATE (estado, respuesta, procesado_por, procesado_en, compra_id) ON recepciones TO contable_app;

-- La pestaña nueva («/recepcion») la ven los roles del equipo que trabajan compras y los dos roles para clientes.
UPDATE perfiles SET pestanas = array_append(pestanas, '/recepcion')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Cliente · Consulta', 'Cliente · Sube documentos')
   AND pestanas IS NOT NULL AND NOT ('/recepcion' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/diario', '/mayor', '/balanza']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
