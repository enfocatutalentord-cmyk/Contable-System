-- Factura electrónica, entrega E1 («sí» de Patricia del 11-nov-2026): registrar las e-CF que la empresa emite fuera del sistema
-- (Facturador Gratuito de la DGII o un proveedor autorizado). El sistema no firma ni envía nada a la DGII: guarda el e-NCF, el
-- código de seguridad y la fecha de firma para el IT-1, los reportes, el IR-2 y los estados. Las notas de crédito pueden ser E34.

-- Por dónde emite la empresa (perfil fiscal).
ALTER TABLE empresas
  ADD COLUMN ecf_via text CHECK (ecf_via IN ('gratuito', 'proveedor')),
  ADD COLUMN ecf_proveedor text CHECK (length(ecf_proveedor) <= 120);

-- Facturas y notas electrónicas: E31, E32, E44, E45, E46 y la nota E34. Su número es tipo + 10 dígitos (13 posiciones).
ALTER TABLE facturas DROP CONSTRAINT facturas_tipo_ncf_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_tipo_ncf_check
  CHECK (tipo_ncf IN ('B01', 'B02', 'B04', 'B14', 'B15', 'B16', 'E31', 'E32', 'E34', 'E44', 'E45', 'E46'));
ALTER TABLE facturas DROP CONSTRAINT facturas_ncf_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_ncf_check
  CHECK (ncf ~ ('^' || tipo_ncf || CASE WHEN tipo_ncf LIKE 'E%' THEN '\d{10}$' ELSE '\d{8}$' END));
ALTER TABLE facturas DROP CONSTRAINT facturas_ncf_externo_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_ncf_externo_check CHECK (ncf_externo ~ '^(B\d{10}|E\d{12})$');
ALTER TABLE facturas DROP CONSTRAINT facturas_check1;
ALTER TABLE facturas ADD CONSTRAINT facturas_nota_origen_check CHECK ((tipo_ncf IN ('B04', 'E34')) = (factura_origen_id IS NOT NULL));
-- Una e-CF no toma número del rango del sistema: se emite solo con el e-NCF que dio el Facturador Gratuito o el proveedor.
ALTER TABLE facturas ADD CONSTRAINT facturas_ecf_externa_check CHECK (tipo_ncf NOT LIKE 'E%' OR estado = 'borrador' OR ncf = ncf_externo);
ALTER TABLE facturas
  ADD COLUMN ecf_codigo text CHECK (ecf_codigo ~ '^[A-Za-z0-9]{4,20}$'), -- código de seguridad, como sale en la factura
  ADD COLUMN ecf_firmada timestamp(0);

-- El saldo cuenta las facturas, no las notas (B04 o E34).
CREATE OR REPLACE VIEW saldos_factura WITH (security_invoker = true) AS
SELECT f.id AS factura_id,
       f.total
       - COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                    WHERE a.factura_id = f.id AND NOT c.anulado), 0)
       - COALESCE((SELECT sum(n.total) FROM facturas n
                    WHERE n.factura_origen_id = f.id AND n.estado = 'emitida' AND NOT n.anulada), 0)
       AS saldo
  FROM facturas f
 WHERE f.tipo_ncf NOT IN ('B04', 'E34') AND f.estado = 'emitida';

-- Bitácora: la nota electrónica también se anota como nota de crédito.
CREATE OR REPLACE FUNCTION gestion_factura() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cliente text;
BEGIN
  SELECT nombre INTO cliente FROM clientes WHERE id = NEW.cliente_id;
  PERFORM anotar_gestion(NEW.empresa_id, NEW.fecha, 'factura',
    CASE WHEN NEW.tipo_ncf IN ('B04', 'E34') THEN 'Nota de crédito ' ELSE 'Factura ' END || NEW.ncf || ' a ' || COALESCE(cliente, 'cliente') ||
    ' por ' || CASE WHEN NEW.moneda = 'USD' THEN 'US$' ELSE 'RD$' END || to_char(NEW.total, 'FM999,999,999,990.00'), 'factura', NEW.id);
  RETURN NULL;
END $$;
