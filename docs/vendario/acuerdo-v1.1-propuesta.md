# Integración Vendario ↔ Empire — propuesta de cambios para el acuerdo v1.1

Propuesta del 13-nov-2026, a partir de las respuestas recomendadas que aprobó el dueño de las dos plataformas. **No está vigente**:
cuando se apruebe, se copia al acuerdo (`docs/21-integracion-empire.md` en Vendario y `docs/vendario/acuerdo.md` aquí) con la versión
1.1 y después se programa en las dos plataformas. Todo es **compatible con la v1.0**: los campos nuevos son opcionales y Empire
sigue aceptando los mensajes sin ellos.

## 1. Retenciones en compras, gastos y pagos (sección 9)

Hoy ningún evento trae lo retenido, así que el IR-17 y las columnas de retención del 606 no pueden salir de Vendario.

Campo nuevo `withholdings` en `data` de `purchase.received`, `expense.posted` y `payable.paid` (y su inverso en `purchase.returned` y
`expense.voided`). Lista vacía o ausente = sin retenciones.

```json
"withholdings": [
  { "tax": "ITBIS", "rate": "30.00", "base": "180.00", "amount": "54.00" },
  { "tax": "ISR",   "rate": "10.00", "base": "1000.00", "amount": "100.00", "ir17_concept": "2" }
]
```

- `tax`: `ITBIS` o `ISR`. `rate` en %, `base` sobre la que se aplicó (ITBIS facturado o monto sin impuestos), `amount` lo retenido.
- `ir17_concept`: código del concepto del formulario IR-17 (solo ISR; opcional, Empire lo pide si falta).
- Se informa en el evento donde se retuvo (normalmente el pago; si se retiene al registrar el gasto, en el gasto).
- Cuentas neutrales nuevas: `RETENCION_ITBIS_POR_PAGAR` y `RETENCION_ISR_POR_PAGAR`. El asiento sugerido acredita lo retenido ahí y
  paga a la caja o el banco solo el neto.

## 2. Tipo de gasto del 606 en las compras (sección 9)

`purchase.received` agrega `dgii_606_type` (dos dígitos, como `category.dgii_606_type` de los gastos). Si no viene, Empire usa
**09** («Compras y gastos que forman parte del costo de venta»), que es el caso de la mercancía para vender.

## 3. Empresas sin RNC (secciones 1 y 7)

Vendario no deja activar «Contabilidad con Empire» si la empresa no tiene RNC o cédula (`org.rnc` vacío), porque sin él no hay 606/607,
IT-1 ni consulta de cuadre (`empire-ledger` busca por `org_rnc`).

## 4. Aclaraciones de lo que ya funciona así

- `service.info_request` es un alias de `service.status` con `status: "necesita_info"` (Vendario ya lo acepta). Empire manda siempre
  `service.status`.
- Respuesta de `empire-ledger` (sección 10), tal como está programada en Vendario:
  `{ "org_rnc", "from", "to", "by_event": { "<event_type>": { "count", "total" } }, "by_account": { "<cuenta>": { "debit", "credit" } }, "ids": [ … ] }`.
- `entry` usa `debit`/`credit` (como el ejemplo de la sección 8).
