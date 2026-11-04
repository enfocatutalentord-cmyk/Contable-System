-- IR-2 2026, parte 3, entrega 3 (4-nov-2026): anexos H-1 y H-2 (beneficiario final y actualización de datos). No son
-- montos sino datos de la sociedad que se guardan una vez por empresa y se reusan cada año: contacto y dirección,
-- accionistas, beneficiarios finales por control accionario y por control efectivo, actividades económicas, sucursales y la
-- «actualización de datos sin cambios». Tienen cédulas y domicilios: quedan aislados por empresa y cada cambio, en el historial.
CREATE TABLE sociedad_ir2 (
  empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  datos jsonb NOT NULL DEFAULT '{}',
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sociedad_ir2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sociedad_ir2 FORCE ROW LEVEL SECURITY;
CREATE POLICY sociedad_ir2_empresa ON sociedad_ir2 USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON sociedad_ir2 TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON sociedad_ir2 FOR EACH ROW EXECUTE FUNCTION auditar();
