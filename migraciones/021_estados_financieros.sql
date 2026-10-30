-- Fase 7, parte 1 (30-oct-2026, «sí» de Joannie a la estructura en 3 partes, al método indirecto del flujo y a la línea de
-- firmas): estado de resultados y estado de situación financiera, con comparativos, como los de QuickBooks Online y Xero.

-- Línea de firmas de los estados en PDF: «Preparado por» (contador con su número del ICPARD) y «Aprobado por».
ALTER TABLE empresas
  ADD COLUMN firma_preparado text,
  ADD COLUMN firma_icpard text,
  ADD COLUMN firma_aprobado text,
  ADD COLUMN firma_cargo text;

-- Pestaña nueva «Estados financieros» (/estados) en Reportes: la ven Contador y Auxiliar (quien ve todo ya la tiene).
UPDATE perfiles SET pestanas = array_append(pestanas, '/estados')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar') AND pestanas IS NOT NULL AND NOT ('/estados' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/estados', '/dgii', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor', '/balanza', '/estados']),
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
