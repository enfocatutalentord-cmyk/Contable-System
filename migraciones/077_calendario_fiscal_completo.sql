-- Prioridad 3 · P3a · Calendario fiscal y renovaciones (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas).
-- El calendario fiscal de la firma suma el anticipo del ISR y el pago a la TSS. Ninguna fecha se inventa: el anticipo viene con el día 15 que ya
-- decía la lista de obligaciones del sistema (marcado «por confirmar») y la TSS queda sin día hasta que la firma lo escriba en Normas y tasas.

ALTER TABLE calendario_fiscal ALTER COLUMN dia DROP NOT NULL;
ALTER TABLE calendario_fiscal DROP CONSTRAINT calendario_fiscal_check;
ALTER TABLE calendario_fiscal DROP CONSTRAINT calendario_fiscal_formato_check;
ALTER TABLE calendario_fiscal ADD CONSTRAINT calendario_fiscal_formato_check
  CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17', 'IR-2', 'Anticipo', 'TSS'));
ALTER TABLE calendario_fiscal ADD CONSTRAINT calendario_fiscal_check
  CHECK (dia IS NULL OR (formato = 'IR-2' AND dia BETWEEN 1 AND 365) OR (formato <> 'IR-2' AND dia BETWEEN 1 AND 31));

ALTER TABLE prorrogas_fiscales DROP CONSTRAINT prorrogas_fiscales_formato_check;
ALTER TABLE prorrogas_fiscales ADD CONSTRAINT prorrogas_fiscales_formato_check
  CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17', 'IR-2', 'Anticipo', 'TSS'));

CREATE OR REPLACE FUNCTION crear_calendario_fiscal(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO calendario_fiscal (firma_id, formato, dia, norma) VALUES
    (fid, '606', 15, 'Norma General 07-2018, art. 8'), (fid, '607', 15, 'Norma General 07-2018, art. 8'),
    (fid, '608', 15, 'Norma General 07-2018, art. 8'), (fid, 'IT-1', 20, 'Ley 11-92 (Código Tributario), art. 353'),
    (fid, 'IR-17', 10, 'Ley 11-92 (Código Tributario), art. 309'), (fid, 'IR-2', 120, 'Ley 11-92 (Código Tributario), art. 299'),
    (fid, 'Anticipo', 15, 'Por confirmar: es el día que dice la lista de obligaciones del sistema'),
    (fid, 'TSS', NULL, 'Por confirmar: escribe el día en que vence el pago a la TSS')
  ON CONFLICT DO NOTHING;
$$;
SELECT crear_calendario_fiscal(id) FROM firmas;
