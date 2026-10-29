-- Fase 6, parte 2 (29-oct-2026): borrador del IT-1 (declaración jurada del ITBIS, formulario IT-1 2020 con su Anexo A).
-- El sistema calcula las casillas con lo registrado; lo que no sabe (importaciones, constructoras, comisionistas,
-- proporcionalidad, penalidades, pagos a cuenta…) lo escribe la contadora. Aquí se guarda solo lo escrito a mano.

CREATE TABLE declaraciones_itbis (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  manuales jsonb NOT NULL DEFAULT '{}',          -- casilla → monto escrito a mano (reemplaza el valor sugerido)
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, periodo)
);
ALTER TABLE declaraciones_itbis ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaraciones_itbis FORCE ROW LEVEL SECURITY;
CREATE POLICY declaraciones_itbis_empresa ON declaraciones_itbis
  USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON declaraciones_itbis TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON declaraciones_itbis FOR EACH ROW EXECUTE FUNCTION auditar();

-- El IT-1 también se marca como presentado; se guardan sus casillas para traer el «saldo a favor anterior» (casilla 29)
-- desde la casilla 34 del mes anterior.
ALTER TABLE envios_dgii DROP CONSTRAINT envios_dgii_formato_check;
ALTER TABLE envios_dgii ADD CONSTRAINT envios_dgii_formato_check CHECK (formato IN ('606', '607', '608', 'IT-1'));
ALTER TABLE envios_dgii ADD COLUMN casillas jsonb;
