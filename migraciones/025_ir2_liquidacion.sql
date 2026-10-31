-- IR-2 2026, parte 2 (31-oct-2026): el borrador de la liquidación (anexos G y E y casillas 1 a 33) se guarda en
-- «declaraciones» como las demás, con período = mes en que termina el ejercicio (AAAAMM), y se marca como presentado en
-- «envios_dgii» con sus casillas: la 33 (nuevo saldo a favor) y las pérdidas pendientes pasan al ejercicio siguiente.
ALTER TABLE declaraciones DROP CONSTRAINT declaraciones_formulario_check;
ALTER TABLE declaraciones ADD CONSTRAINT declaraciones_formulario_check CHECK (formulario IN ('IT-1', 'IR-17', 'IR-2'));
ALTER TABLE envios_dgii DROP CONSTRAINT envios_dgii_formato_check;
ALTER TABLE envios_dgii ADD CONSTRAINT envios_dgii_formato_check CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17', 'IR-2'));
