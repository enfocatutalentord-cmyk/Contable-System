-- Prioridad 1.3 del prompt de Patricia (20-nov-2026): a los clientes no se les lleva contabilidad en ninguna pantalla ni rol. Solo las
-- empresas de la dueña (Contabilidad) la llevan. No se borra nada: lo que un cliente tenga guardado (asientos, facturas, compras) queda.

UPDATE empresas SET lleva_contabilidad = false WHERE NOT contabilidad_propia AND lleva_contabilidad;

-- «Cliente · Factura» (E3a) queda escondido (respuesta recomendada 1): sus pantallas de facturar ya no se abren en un cliente. Quien lo
-- tenga ve lo mismo que «Cliente · Con aplicación»: inicio, sus facturas subidas, sus documentos y sus solicitudes.
UPDATE perfiles SET pestanas = ARRAY['', '/facturas-subidas', '/recepcion', '/solicitudes']
 WHERE sistema AND nombre = 'Cliente · Factura';
