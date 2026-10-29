-- 30-oct-2026 («sí» de Joannie): retención de ISR por alquileres al 15 % desde el 1-jul-2026. La tasa sale del formulario
-- oficial «IR-17-2026, desde julio 2026 en adelante» (casilla 1, Ley 30-26). Se agrega a la configuración sugerida de las
-- empresas nuevas y a las que ya existen (si ya tienen una retención con ese nombre, no se toca). Su concepto del IR-17
-- (casilla 1) lo pone el trigger «retenciones_ir17» desde el tipo 1 del 606.

CREATE OR REPLACE FUNCTION configurar_tributaria(eid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.empresa_id', eid::text, true);

  INSERT INTO impuestos (empresa_id, nombre, tipo, tasa, cuenta_ventas_id, cuenta_compras_id, vigente_desde, nota)
  SELECT eid, i.nombre, i.tipo, i.tasa,
         CASE WHEN i.tasa > 0 THEN v.id END, CASE WHEN i.tasa > 0 THEN c.id END, '2000-01-01', i.nota
    FROM (VALUES
      ('ITBIS 18 %', 'itbis', 18, 'Tasa general (Código Tributario, art. 341).'),
      ('ITBIS 16 %', 'itbis', 16, 'Tasa reducida para los bienes que indica la Ley 253-12.'),
      ('Exento', 'exento', 0, 'Bienes y servicios exentos (Código Tributario, arts. 343 y 344).')
    ) AS i(nombre, tipo, tasa, nota)
    LEFT JOIN cuentas v ON v.empresa_id = eid AND v.codigo = '210201' AND v.de_detalle AND v.activa
    LEFT JOIN cuentas c ON c.empresa_id = eid AND c.codigo = '110401' AND c.de_detalle AND c.activa
   WHERE i.tasa = 0 OR (v.id IS NOT NULL AND c.id IS NOT NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO retenciones (empresa_id, nombre, impuesto, tasa, cuenta_por_terceros_id, cuenta_a_terceros_id, codigo_606,
                           vigente_desde, vigente_hasta, nota)
  SELECT eid, r.nombre, r.impuesto, r.tasa, pt.id, at.id, r.codigo, r.desde::date, r.hasta::date, r.nota
    FROM (VALUES
      ('ITBIS retenido 30 %', 'itbis', 30, NULL, '2000-01-01', NULL, '110404', '210202',
       'Norma General 02-05 y sus modificaciones. Desde el 16-sep-2026 no aplica cuando el proveedor es persona jurídica, emisor electrónico y factura con e-CF (Norma General 02-2026).'),
      ('ITBIS retenido 100 %', 'itbis', 100, NULL, '2000-01-01', NULL, '110404', '210202',
       'Norma General 02-05 y sus modificaciones (por ejemplo, servicios de personas físicas).'),
      ('ISR honorarios a personas físicas 10 %', 'isr', 10, 2, '2000-01-01', '2026-06-30', '110403', '210203',
       'Código Tributario, art. 309. Sustituida por el 15 % desde el 1-jul-2026.'),
      ('ISR honorarios a personas físicas 15 %', 'isr', 15, 2, '2026-07-01', NULL, '110403', '210203',
       'Ley 30-26, desde el 1-jul-2026.'),
      ('ISR proveedores del Estado 5 %', 'isr', 5, 7, '2000-01-01', NULL, '110403', '210203',
       'Retención que hacen las entidades del Estado a sus proveedores.'),
      ('ISR alquileres 15 %', 'isr', 15, 1, '2026-07-01', NULL, '110403', '210203',
       'Ley 30-26, desde el 1-jul-2026 (formulario IR-17 2026, casilla 1: alquileres 15 %).')
    ) AS r(nombre, impuesto, tasa, codigo, desde, hasta, cod_terceros, cod_a_terceros, nota)
    JOIN cuentas pt ON pt.empresa_id = eid AND pt.codigo = r.cod_terceros AND pt.de_detalle AND pt.activa
    JOIN cuentas at ON at.empresa_id = eid AND at.codigo = r.cod_a_terceros AND at.de_detalle AND at.activa
  ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM empresas LOOP
    PERFORM configurar_tributaria(e.id);
  END LOOP;
  PERFORM set_config('app.empresa_id', '', true);
END $$;
