-- Rediseño R3 (Lista de rediseños de Patricia, 6-nov-2026, n.º 8, 14 y 20): a los clientes no se les lleva contabilidad.
-- Nada se borra: los asientos, el catálogo y los bancos que tenga un cliente siguen guardados; solo dejan de verse.

-- Marca de la ficha (Relación con Empire): solo con ella un cliente ve asientos, libros, catálogo, cuentas, bancos y cierre del mes.
-- La empresa propia (Contabilidad Empire) siempre los ve.
ALTER TABLE empresas ADD COLUMN lleva_contabilidad boolean NOT NULL DEFAULT false;

-- Los usuarios de los clientes solo usan la aplicación: su inicio, sus facturas, sus documentos y sus solicitudes (n.º 20).
-- No ven facturas emitidas, cobros, compras, cuentas por pagar ni reportes dentro del sistema.
UPDATE perfiles SET pestanas = ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']
 WHERE sistema AND nombre IN ('Cliente · Consulta', 'Cliente · Sube documentos');

-- Las firmas nuevas reciben los mismos roles.
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
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Prospecto', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Con aplicación', ARRAY['ver','adjuntar','exportar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
