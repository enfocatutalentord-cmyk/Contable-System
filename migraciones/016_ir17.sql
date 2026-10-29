-- Fase 6, parte 3 (30-oct-2026): IR-17 (declaración jurada y/o pago de otras retenciones y retribuciones complementarias),
-- formulario oficial «IR-17-2026, desde julio 2026 en adelante» con su anexo IR-6.

-- Concepto del IR-17 (casillas 1 a 24) de cada retención de ISR. Se completa solo donde el tipo del 606 lo dice sin duda.
ALTER TABLE retenciones ADD COLUMN codigo_ir17 smallint CHECK (codigo_ir17 BETWEEN 1 AND 24);
ALTER TABLE retenciones ADD CONSTRAINT retenciones_ir17_solo_isr CHECK (impuesto = 'isr' OR codigo_ir17 IS NULL);

CREATE FUNCTION ir17_por_606(c smallint) RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
  -- 606 → IR-17: 1 alquileres → 1; 2 honorarios → 2; 7 proveedores del Estado → 12; 8 juegos telefónicos → 13;
  -- 9 ganadería de carne bovina → 21. «Otras rentas» e intereses tienen varias casillas posibles: los elige la firma.
  SELECT CASE c WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 7 THEN 12 WHEN 8 THEN 13 WHEN 9 THEN 21 END::smallint
$$;
UPDATE retenciones SET codigo_ir17 = ir17_por_606(codigo_606) WHERE impuesto = 'isr' AND codigo_ir17 IS NULL;

CREATE FUNCTION retenciones_ir17() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.impuesto = 'isr' AND NEW.codigo_ir17 IS NULL THEN NEW.codigo_ir17 := ir17_por_606(NEW.codigo_606); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retenciones_ir17 BEFORE INSERT ON retenciones FOR EACH ROW EXECUTE FUNCTION retenciones_ir17();

-- Borradores de las declaraciones (IT-1, IR-17…): lo escrito a mano, por formulario y período.
CREATE TABLE declaraciones (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  formulario text NOT NULL CHECK (formulario IN ('IT-1', 'IR-17')),
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  manuales jsonb NOT NULL DEFAULT '{}',
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, formulario, periodo)
);
ALTER TABLE declaraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaraciones FORCE ROW LEVEL SECURITY;
CREATE POLICY declaraciones_empresa ON declaraciones USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON declaraciones TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON declaraciones FOR EACH ROW EXECUTE FUNCTION auditar();

INSERT INTO declaraciones (empresa_id, formulario, periodo, manuales, actualizado_por, actualizado_en)
SELECT empresa_id, 'IT-1', periodo, manuales, actualizado_por, actualizado_en FROM declaraciones_itbis;
DROP TABLE declaraciones_itbis;

ALTER TABLE envios_dgii DROP CONSTRAINT envios_dgii_formato_check;
ALTER TABLE envios_dgii ADD CONSTRAINT envios_dgii_formato_check CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17'));
