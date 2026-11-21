-- Prioridad 2.2 (P2e.2, 21-nov-2026): el reporte mensual del día 30 con casillas para elegir qué secciones lleva el PDF y si trae la factura del mes.
-- Lo que no se marca sigue en la pantalla de la firma, pero no va en el PDF que recibe el cliente.
ALTER TABLE reportes_mensuales
  ADD COLUMN incluir text[] NOT NULL DEFAULT ARRAY['servicios', 'facturas', 'itbis', 'retenciones', 'declaraciones', 'pendientes', 'cuenta', 'factura'];
