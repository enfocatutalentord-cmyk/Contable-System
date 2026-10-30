-- Fase 5, parte 3 (30-oct-2026): conciliación del mes cerrada, como «Reconcile» de QuickBooks Online (se guarda el
-- saldo del estado de cuenta, el de libros y el reporte de ese momento) y el reporte de conciliación de Xero. Cerrarla no
-- bloquea los asientos (eso lo hace el cierre del mes); guarda la foto y avisa si algo cambia después.
CREATE TABLE cierres_conciliacion (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id uuid NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  saldo_banco numeric(18,2) NOT NULL,
  saldo_libros numeric(18,2) NOT NULL,
  partidas jsonb NOT NULL,                     -- resumen del reporte al cerrar
  huella text NOT NULL,
  cerrado_por uuid NOT NULL REFERENCES usuarios(id),
  cerrado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_bancaria_id, periodo)
);
CREATE TRIGGER cierres_conciliacion_referencias BEFORE INSERT ON cierres_conciliacion FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas_bancarias.cuenta_bancaria_id');
ALTER TABLE cierres_conciliacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_conciliacion FORCE ROW LEVEL SECURITY;
CREATE POLICY cierres_conciliacion_empresa ON cierres_conciliacion USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, DELETE ON cierres_conciliacion TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON cierres_conciliacion FOR EACH ROW EXECUTE FUNCTION auditar();
