# Integración Vendario ↔ Empire — acuerdo v1.0 (aprobado el 13-nov-2026)

Este documento lo usan **las dos plataformas**. Si algo cambia, cambia aquí primero y sube la versión.
Vendario es la fuente de los datos de ventas, compras, gastos, caja y NCF; Empire lleva la contabilidad.
Solo participan las empresas que el administrador active en Vendario **y** cuyo dueño autorice compartir sus datos.

---

## 1. Flujo completo

```
Panel de Vendario: el administrador activa «Contabilidad con Empire» (servicios, fecha de inicio, contacto)
        │
Vendario (cliente): el dueño ve el aviso y AUTORIZA compartir sus datos ─── si no autoriza, no sale nada
        │
        ├─► client.enroll ──────────────────────────────► Empire crea la solicitud y avisa al equipo
        │                                                   │
        │◄── service.status «recibida» ◄────────────────────┤ (al recibir)
        │◄── service.status «vista» ◄───────────────────────┤ (cuando un contable la abre)
        │◄── service.status «aceptada» / «necesita_info» ◄──┘ (decisión del contable)
        │
        ├─► accounting.event (histórico desde la fecha de inicio, marcado historical=true)
        ├─► sync.history_complete (totales del histórico, para cuadrar)
        ├─► accounting.event (cada operación nueva, en el momento)
        │◄── service.status «en_proceso» / «al_dia» (período) / «necesita_info» / «suspendida»
        │
        └─► client.unenroll (baja) ──────────────────────► Empire responde «finalizada»
```

- Antes de que Empire responda **«aceptada»**, Vendario guarda los eventos pero no los envía. Al recibir «aceptada», manda primero el histórico y después lo acumulado, en orden.
- El cliente ve cada cambio de estado con fecha y hora en **Mi contabilidad**. Esa es su constancia.

## 2. Direcciones

| Sentido | Método y dirección | Para qué |
|---|---|---|
| Vendario → Empire | `POST {EMPIRE_URL}/api/vendario/v1/inbox` | Altas, cambios, bajas y eventos contables |
| Empire → Vendario | `POST https://semwrlqhurdgphahrvkv.supabase.co/functions/v1/empire-inbox` | Cambios de estado y pedidos de información |
| Empire → Vendario | `POST https://semwrlqhurdgphahrvkv.supabase.co/functions/v1/empire-ledger` | Consulta de cuadre por rango de fechas |

`EMPIRE_URL` lo define Empire. Solo HTTPS.

## 3. Seguridad

- **Firma HMAC-SHA256** en cada mensaje, con **una clave por sentido**: `V2E_SECRET` firma lo que manda Vendario y `E2V_SECRET` lo que manda Empire. Cada plataforma guarda las dos en sus secretos del servidor; nunca en el código ni en el navegador.
- Encabezado: `X-Signature: t=<segundos unix>,v1=<hex(HMAC_SHA256(clave, "<t>.<cuerpo exacto>"))>`.
- Quien recibe rechaza (401) si la firma no coincide o si `t` difiere más de **5 minutos** de su hora. Compara en tiempo constante.
- **Rotación:** durante un cambio de clave se aceptan dos (`v1` puede repetirse: `v1=…,v1=…`).
- Solo viaja lo que el servicio necesita (sección 7). No viajan contraseñas, datos de tarjetas, fotos ni el detalle de productos, salvo en los servicios que lo pidan.

## 4. Sobre común de todo mensaje

```json
{
  "version": "1.0",
  "id": "8f6c1e0a-5b2d-4c1e-9a7b-0c3d2e1f4a5b",
  "type": "accounting.event",
  "created_at": "2026-11-13T14:05:22Z",
  "org": { "vendario_id": "77bb183d-…", "rnc": "133833964" },
  "seq": 1042,
  "data": { }
}
```

- `id`: único por mensaje. Quien recibe **no registra dos veces el mismo id**: si ya lo tiene, responde 200 con `{"duplicate": true}`.
- `seq`: número creciente por empresa, para eventos contables. Permite detectar huecos y ordenar.
- Montos: texto con 2 decimales (`"1180.00"`), moneda DOP. Fechas: `YYYY-MM-DD` en hora de Santo Domingo; momentos: ISO-8601 en UTC.

## 5. Entrega, respuestas y reintentos

| Respuesta | Significado | Qué hace quien envía |
|---|---|---|
| 200 / 202 | Recibido (o duplicado) | Lo marca como entregado |
| 401 | Firma o hora inválida | No reintenta solo; alerta en el panel |
| 422 | Mensaje inválido (con `{"error": "…"}`) | No reintenta; queda fallido con el motivo |
| 5xx, tiempo agotado o sin conexión | Falla temporal | Reintenta |

- Reintentos con espera creciente: 1 min, 5 min, 30 min, 2 h, 6 h y 24 h. Después queda **fallido**, aparece la alerta en el panel y se puede **reenviar** a mano.
- Quien recibe responde rápido (menos de 10 s) y procesa después. Un evento que no puede contabilizar (por ejemplo, una cuenta sin mapear) **no se rechaza**: se acepta y queda en sus pendientes.

## 6. Estados del servicio (Empire → Vendario)

| Código | Lo envía | Qué ve el cliente | ¿Aviso al cliente? |
|---|---|---|---|
| `enviada` | Vendario (interno, al mandar el alta) | «Enviamos tu solicitud a Empire» | — |
| `recibida` | Empire, al recibir el alta | «Empire recibió tu solicitud» | — |
| `vista` | Empire, cuando un contable la abre | «La vio {contable}» | Sí |
| `aceptada` | Empire | «Aceptada: {contable} lleva tu contabilidad» | Sí |
| `en_proceso` | Empire | «Trabajando el período {período}» | — |
| `al_dia` | Empire, al cerrar un período | «Tu contabilidad está al día hasta {período}» | Sí |
| `necesita_info` | Empire, con nota | «Empire necesita: {nota}» | Sí (destacado) |
| `suspendida` | Empire, con nota | «Servicio en pausa: {nota}» | Sí |
| `finalizada` | Empire, tras la baja | «Servicio terminado» | Sí |

Mensaje `service.status`:

```json
{ "status": "necesita_info", "at": "2026-11-13T15:10:00Z",
  "accountant": { "name": "Patricia M." },
  "period": "2026-10",
  "note": "Falta el estado de cuenta bancario de octubre.",
  "requested": ["estado_cuenta_banco"] }
```

Un estado solo se acepta si llega después del último guardado (por `at`); los repetidos se ignoran.

## 7. Catálogo de servicios (códigos compartidos) — **propuesta, confirmar con Empire**

| Código | Servicio | Eventos que necesita |
|---|---|---|
| `registro_contable` | Registro contable mensual | Todos |
| `itbis_606_607_608` | Formatos 606/607/608 e IT-1 | Ventas, devoluciones, anulaciones, compras, gastos |
| `retenciones_ir17` | Retenciones (IR-17) | Compras y gastos con suplidor |
| `estados_financieros` | Estados financieros | Todos |
| `ir2_anual` | Declaración anual (IR-1/IR-2) | Todos |
| `asesoria` | Asesoría | Ninguno (solo el alta) |

Si una empresa tiene varios servicios, se envía la unión de los eventos que necesitan. La nómina y la TSS no salen de Vendario, porque Vendario no maneja nómina.

## 8. Mensajes Vendario → Empire

### `client.enroll` (alta)
```json
{ "services": ["registro_contable", "itbis_606_607_608"],
  "start_date": "2026-10-01",
  "history": { "from": "2026-10-01", "to": "2026-11-13" },
  "company": { "rnc": "133833964", "legal_name": "ALL IN ONE FERRETERIA Y SERVICIOS SRL",
               "trade_name": "All In One", "address": "…", "phone": "…",
               "rnc_status": "ACTIVO", "no_fiscal": false },
  "contact": { "name": "…", "email": "…", "phone": "…" },
  "authorization": { "by_name": "…", "by_email": "…", "at": "2026-11-13T14:00:00Z",
                     "text_version": "2026-11-13" } }
```
- `client.update`: mismos campos, cuando cambian los servicios, el contacto o los datos de la empresa.
- `client.unenroll`: `{ "reason": "desactivado_por_admin" | "autorizacion_retirada", "at": "…" }`. Después no se envía nada más de esa empresa.
- `sync.history_complete`: `{ "from", "to", "events": 312, "totals": { "<event_type>": { "count", "total" } } }`.

### `accounting.event`
Campos comunes de `data`:

```json
{ "event_type": "sale.posted",
  "source": { "kind": "sale", "id": "uuid", "number": "V-00000123" },
  "reverses": null,
  "historical": false,
  "date": "2026-11-13",
  "occurred_at": "2026-11-13T14:05:20Z",
  "branch": { "id": "uuid", "name": "Principal" },
  "fiscal": { "ncf": "B0100000045", "ncf_type": "01", "modified_ncf": null },
  "party": { "kind": "customer", "doc_type": "RNC", "doc": "101234567", "name": "Constructora X" },
  "amounts": { "subtotal": "1000.00", "discount": "0.00",
               "taxes": [ { "code": "ITBIS18", "rate": "18.00", "base": "1000.00", "tax": "180.00" } ],
               "total": "1180.00" },
  "payments": [ { "kind": "cash", "method": "Efectivo", "amount": "1180.00", "reference": null } ],
  "cost_of_sales": "640.00",
  "entry": [ { "account": "CAJA", "debit": "1180.00", "credit": "0.00" },
             { "account": "VENTAS", "debit": "0.00", "credit": "1000.00" },
             { "account": "ITBIS_POR_PAGAR", "debit": "0.00", "credit": "180.00" },
             { "account": "COSTO_VENTAS", "debit": "640.00", "credit": "0.00" },
             { "account": "INVENTARIO", "debit": "0.00", "credit": "640.00" } ] }
```

- `entry` siempre **cuadra** (suma de débitos = suma de créditos, al centavo). Si el redondeo deja una diferencia, va a `REDONDEO`.
- `party` es `null` en ventas a consumidor final sin documento.
- `reverses`: en anulaciones, el `id` del evento original. El asiento es el inverso del original.

## 9. Eventos contables y su asiento sugerido

Cuentas neutrales; Empire las mapea al catálogo de cada cliente.

| Cuenta neutral | Qué es |
|---|---|
| `CAJA` | Efectivo |
| `BANCO` | Transferencias y depósitos |
| `TARJETAS_POR_COBRAR` | Ventas con tarjeta pendientes de liquidar |
| `CXC_CLIENTES` | Cuentas por cobrar |
| `ANTICIPOS_CLIENTES` | Saldo a favor de clientes |
| `INVENTARIO` | Mercancía |
| `CXP_SUPLIDORES` | Cuentas por pagar |
| `ITBIS_POR_PAGAR` | ITBIS cobrado en ventas |
| `ITBIS_ADELANTADO` | ITBIS pagado en compras y gastos |
| `VENTAS` / `DEVOLUCIONES_VENTAS` | Ingresos por ventas y sus devoluciones (base sin ITBIS) |
| `COSTO_VENTAS` | Costo de lo vendido (costo promedio de Vendario) |
| `GASTO:<categoría>` | Gasto por categoría de Vendario (incluye el tipo de gasto 606) |
| `AJUSTE_INVENTARIO` | Pérdidas, daños y sobrantes de inventario |
| `FALTANTE_CAJA` / `SOBRANTE_CAJA` | Diferencias del cierre de caja |
| `RETIROS_CAJA` | Retiros y depósitos de caja a banco o al dueño |
| `OTROS_INGRESOS` | Entradas manuales de efectivo a la caja |
| `REDONDEO` | Centavos de redondeo |

Por forma de pago (`payment_methods.kind`): `cash` → CAJA · `transfer` → BANCO · `card` → TARJETAS_POR_COBRAR · `credit` → CXC_CLIENTES · `balance` → ANTICIPOS_CLIENTES · `other` → CAJA.

| `event_type` | Cuándo | Asiento sugerido |
|---|---|---|
| `sale.posted` | Venta cobrada o a crédito | D formas de pago · C VENTAS (base) · C ITBIS_POR_PAGAR · D COSTO_VENTAS · C INVENTARIO |
| `sale.voided` | Anulación | Inverso exacto de la venta (`reverses`) |
| `sale.returned` | Devolución (nota de crédito B04 si hay NCF) | D DEVOLUCIONES_VENTAS · D ITBIS_POR_PAGAR · C forma de reembolso · D INVENTARIO · C COSTO_VENTAS |
| `receivable.paid` | Cobro de CxC | D CAJA/BANCO · C CXC_CLIENTES |
| `customer.advance` / `customer.advance_refund` | Saldo a favor recibido o devuelto | D CAJA · C ANTICIPOS_CLIENTES (y el inverso) |
| `purchase.received` | Recepción de compra | D INVENTARIO (base) · D ITBIS_ADELANTADO · C CXP_SUPLIDORES — con NCF y RNC del suplidor |
| `purchase.returned` | Devolución a suplidor | Inverso proporcional de la compra |
| `payable.paid` | Pago a suplidor | D CXP_SUPLIDORES · C CAJA/BANCO |
| `expense.posted` / `expense.voided` | Gasto y su anulación | D GASTO:<categoría> · D ITBIS_ADELANTADO · C CAJA/BANCO (y el inverso) — con NCF, RNC y tipo 606 |
| `inventory.adjusted` | Ajuste, daño o pérdida (no transferencias) | Pérdida: D AJUSTE_INVENTARIO · C INVENTARIO; sobrante: el inverso — valorado al costo |
| `cash.movement` | Retiro, depósito, ingreso o gasto manual de caja | D/C CAJA contra RETIROS_CAJA (retiro o depósito), OTROS_INGRESOS (ingreso) o GASTO:Caja (gasto) |
| `cash.closed` | Cierre de caja | Solo la diferencia: faltante D FALTANTE_CAJA · C CAJA; sobrante el inverso. Incluye los totales del turno como información (no se vuelven a asentar) |

Las transferencias entre sucursales de la misma empresa no se envían: no cambian la contabilidad. La venta sin conexión se envía cuando se sincroniza, con su fecha real.

## 10. Consulta de cuadre (Empire → Vendario)

`POST /functions/v1/empire-ledger`, firmado con `E2V_SECRET`:

```json
{ "org_rnc": "133833964", "from": "2026-10-01", "to": "2026-10-31" }
```

Respuesta: por cada `event_type`, la cantidad y la suma de `total`; por cada cuenta neutral, la suma de débitos y créditos; y la lista de `id` de eventos del rango. Con eso Empire compara contra lo que recibió y pide reenviar lo que falte.

## 11. Avisos

- **Al cliente (en la app de Vendario):** cuando Empire marca `vista`, `aceptada`, `al_dia`, `necesita_info`, `suspendida` o `finalizada`.
- **Al administrador (panel de Vendario):** alerta si los envíos a Empire fallan, igual que la de correos (D137).
- **En Empire:** al llegar un alta nueva, al equipo contable.

## 12. Decisiones tomadas (13-nov-2026) y lo que falta

1. `EMPIRE_URL`: se guarda en el panel maestro (Empresas → la empresa → Contabilidad con Empire → «Dirección de Empire»). Sin dirección, los mensajes esperan en cola.
2. Catálogo de servicios: el de la sección 7. Empire lo puede pedir ampliar en una versión nueva del acuerdo.
3. Cobro del servicio contable: aparte, en Empire. Vendario no lo suma a la mensualidad.
4. Histórico al activar: hasta 12 meses antes de la activación.
5. Avisos al cliente: en la app (campana y Mi contabilidad), no por correo.
6. Claves: `V2E_SECRET` y `E2V_SECRET` se generan una vez y se guardan en los secretos de las dos plataformas. Vendario: Supabase → Edge Functions → Secrets.
7. Entre la autorización y la aceptación, los eventos esperan en Vendario («esperando aceptación»). Si el servicio se desactiva antes de aceptar, se descartan sin enviarse.
