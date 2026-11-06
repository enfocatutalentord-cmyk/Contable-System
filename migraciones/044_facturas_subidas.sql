-- Bloque 8, entrega 8b: el cliente sube sus facturas de ingresos y de gastos desde la aplicación (documento «Sistema Empire ·
-- Fase 2», sección 3). Se revisan solas al subirlas (formato y dígito verificador del RNC, NCF, repetida, a nombre de otra
-- empresa, sin crédito fiscal) y Empire las aprueba, rechaza o desestima. Al aprobar, el gasto pasa a borrador de compra y el
-- ingreso a borrador de venta con el NCF del cliente (`facturas.ncf_externo`), que al emitirse no toma número del rango.

CREATE TABLE facturas_subidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('gasto', 'ingreso')),
  forma text NOT NULL CHECK (forma IN ('foto', 'pdf', 'qr', 'manual')),
  rnc_contraparte text CHECK (rnc_contraparte ~ '^\d{9}$|^\d{11}$'),   -- proveedor (gasto) o cliente (ingreso)
  nombre_contraparte text CHECK (length(nombre_contraparte) <= 200),
  ncf text CHECK (ncf ~ '^(B\d{10}|E\d{12})$'),
  fecha date,
  subtotal numeric(18,2) CHECK (subtotal >= 0),
  itbis numeric(18,2) CHECK (itbis >= 0),
  total numeric(18,2) CHECK (total >= 0),
  qr_url text CHECK (length(qr_url) <= 1000),
  marcas jsonb NOT NULL DEFAULT '[]',                   -- avisos de la revisión automática
  sin_credito boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida', 'rechazada', 'aprobada', 'desestimada')),
  motivo text CHECK (length(motivo) <= 500),
  compra_id uuid REFERENCES compras(id) ON DELETE SET NULL,
  factura_id uuid REFERENCES facturas(id) ON DELETE SET NULL,
  subido_por uuid NOT NULL REFERENCES usuarios(id),
  subido_en timestamptz NOT NULL DEFAULT now(),
  revisado_por uuid REFERENCES usuarios(id),
  revisado_en timestamptz,
  UNIQUE (empresa_id, numero)
);
CREATE INDEX facturas_subidas_idx ON facturas_subidas(empresa_id, estado, subido_en DESC);
ALTER TABLE facturas_subidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_subidas FORCE ROW LEVEL SECURITY;
CREATE POLICY facturas_subidas_empresa ON facturas_subidas USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON facturas_subidas TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON facturas_subidas FOR EACH ROW EXECUTE FUNCTION auditar();

-- El archivo de la factura (foto o PDF) va en documentos.
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite',
                     'formulario', 'factura_subida'));

-- Venta del cliente hecha fuera del sistema (talonario o Facturador Gratuito): al emitirse usa este NCF y no toma del rango.
ALTER TABLE facturas ADD COLUMN ncf_externo text CHECK (ncf_externo ~ '^B\d{10}$');

-- La pestaña «Facturas subidas» («Mis facturas» para el cliente).
CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios',
           '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/anticipos', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion']),
    (fid, 'Cliente · Prospecto', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Con aplicación', ARRAY['ver','adjuntar','exportar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;

UPDATE perfiles SET pestanas = array_append(pestanas, '/facturas-subidas')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Coordinadora', 'Cliente · Con aplicación') AND pestanas IS NOT NULL
   AND NOT ('/facturas-subidas' = ANY (pestanas));

-- Con NCF externo no se sabe su vencimiento (lo da el rango del cliente): la factura emitida puede ir sin él.
ALTER TABLE facturas DROP CONSTRAINT facturas_emision_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_emision_check CHECK (
  (estado = 'emitida' AND ncf IS NOT NULL AND (ncf_vence IS NOT NULL OR ncf_externo IS NOT NULL) AND asiento_id IS NOT NULL)
  OR (estado = 'borrador' AND ncf IS NULL AND asiento_id IS NULL AND NOT anulada));
