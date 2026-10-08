# Munch Mate — Definición de producto

> Documento vivo. Define qué se construye y en qué orden. Las reglas técnicas están en `CLAUDE.md`.

## Visión

Plataforma SaaS multi-restaurante para recibir y gestionar pedidos por **QR en la mesa**, **retiro en local** y **delivery**. La cocina y el staff ven los pedidos **en tiempo real**, y el cliente sigue el estado de su pedido en vivo.

El proyecto tiene dos objetivos: ser un **MVP real y desplegable** y, de paso, ejercitar todo el stack (tiempo real, colas, almacenamiento S3, PDF, email, push).

---

## Actores

| Actor | Alcance | Qué hace |
| --- | --- | --- |
| **Platform admin** | Toda la plataforma | Da de alta y suspende restaurantes |
| **Owner** | Su restaurante | Configura el restaurante, el menú, las mesas, las zonas de delivery y el staff |
| **Staff — caja** | Su restaurante | Acepta o rechaza pedidos y marca los pagos |
| **Staff — cocina** | Su restaurante | Ve la cola de pedidos y cambia los estados de preparación |
| **Staff — repartidor** | Su restaurante | Ve sus entregas asignadas y las marca como entregadas. Es opcional: un restaurante puede no tener repartidores en el sistema |
| **Cliente invitado** | Un pedido | Pide sin registrarse y sigue su pedido con un link privado |
| **Cliente registrado** | Toda la plataforma | Igual que el invitado, más historial y datos guardados. La cuenta es global, no por restaurante |

Un usuario de staff puede tener varios roles dentro del mismo restaurante.

---

## Canales de pedido

| Canal | Entrada | Identificación | Pago (MVP) |
| --- | --- | --- | --- |
| `dine_in` | QR de la mesa → `/m/{tableToken}` | La mesa | En el local |
| `pickup` | `/r/{slug}` (si el local activó el retiro) | Nombre y teléfono; email opcional para recibir el comprobante | En el local, al retirar |
| `delivery` | `/r/{slug}` (si el local activó el delivery) | Nombre, teléfono, zona (viene elegida la del local) y dirección | Contra entrega; en efectivo puede indicar con cuánto paga |

---

## Ciclo de vida del pedido

```
                ┌──────────► rejected
                │
pending ──► accepted ──► preparing ──► ready ──┬──► served            (dine_in)
   │            │                              ├──► picked_up         (pickup)
   │            │                              └──► out_for_delivery ──► delivered  (delivery)
   └────────────┴──► cancelled
```

- Solo se puede cancelar en `pending` o `accepted`. Después de eso, el pedido ya está en cocina.
- **El estado de pago va aparte del estado del pedido**: `unpaid` → `paid`, con método `cash`, `card_pos` o `transfer`. El staff lo marca a mano.
- Cada cambio de estado queda registrado en un historial con quién lo hizo y cuándo, y se emite por WebSocket.

---

## Alcance del MVP

### Restaurante (panel `/admin`)
- Perfil con nombre, slug, logo, horario, moneda y zona horaria
- **Menú**: categorías, productos con foto, precio y disponibilidad, y **grupos de modificadores** (por ejemplo "Tamaño" obligatorio con una opción, "Extras" opcional con varias)
- **Mesas**: CRUD y un PDF con los QR para imprimir
- **Delivery**: zonas definidas como lista de comunas o sectores, cada una con su costo de envío y pedido mínimo
- **Staff**: invitación por email y asignación de roles
- **Tablero de pedidos en vivo**, filtrado por canal y estado, con sonido y push al entrar un pedido nuevo

### Cliente (público `/r/{slug}`)
- Menú navegable, carrito y checkout según el canal
- Página de seguimiento del pedido en tiempo real
- Email de confirmación y **comprobante en PDF**. Es un documento interno, **no una boleta electrónica tributaria**
- Cuenta opcional: historial de pedidos y direcciones guardadas

### Uso del stack

| Pieza | Dónde se usa |
| --- | --- |
| Socket.IO | Tablero de cocina y caja, seguimiento del pedido |
| BullMQ `email` | Confirmación de pedido, invitación de staff, verificación de cuenta |
| BullMQ `pdf` | Comprobante de pedido, hoja de QR de mesas |
| BullMQ `notif` | Push al staff (pedido nuevo) y al cliente (pedido listo) |
| Garage (S3) | Fotos de productos, logos, PDF generados |
| Transacciones Mongo | Crear un pedido junto con su snapshot de precios |

### Fuera del MVP
- Pagos online (pasarela)
- Boleta o factura electrónica (SII)
- Seguimiento GPS del repartidor y zonas dibujadas en un mapa
- Varias sucursales por restaurante
- Inventario y stock
- Reservas
- Reportes avanzados (en el MVP solo hay un resumen de ventas del día)
- Varios idiomas

---

## Modelo de datos inicial (propuesta, falta validarla)

| Colección | Tenant | Campos clave |
| --- | --- | --- |
| `restaurants` | — | `slug` (único), `name`, `description`, `phone`, `logoKey`, `currency`, `timezone`, `status`, `createdBy`, `membershipVersion`, `acceptingOrders`, `pickupEnabled`, `deliveryEnabled` ✅ · pendiente: `openingHours` |
| `users` | — | `email` (único), `passwordHash`, `name`, `emailVerifiedAt`, `platformRole?` ✅ |
| `sessions` | — | `userId`, `familyId`, `tokenHash`, `expiresAt`, `rotatedAt`, `revokedAt` ✅ |
| `one_time_tokens` | — | `type` (`verify_email` / `password_reset`), `tokenHash`, `userId`, `expiresAt`, `usedAt` ✅ |
| `memberships` | ✔ | `userId`, `restaurantId`, `roles[]` (`owner`, `cashier`, `kitchen`, `rider`) ✅ |
| `invitations` | ✔ | `email`, `roles[]`, `tokenHash`, `invitedBy`, `expiresAt`, `acceptedAt`, `revokedAt` ✅ |
| `menu_categories` | ✔ | `name`, `description`, `position`, `active` ✅ |
| `products` | ✔ | `categoryId`, `name`, `description`, `price`, `imageKey`, `available` (agotado), `visible`, `modifierGroupIds[]`, `position` ✅ |
| `modifier_groups` | ✔ | `name`, `minSelect`, `maxSelect`, `options[]` (`name`, `priceDelta`, `available`) — biblioteca reutilizable entre productos ✅ |
| `tables` | ✔ | `label`, `token` (único, va en el QR `/m/{token}`, regenerable), `active` ✅ |
| `delivery_zones` | ✔ | `name`, `fee`, `minOrder`, `active`, `isHome` (zona del local, preseleccionada), `position` ✅ |
| `orders` | ✔ | `number` (global), `ticketNumber` (diario), `businessDate`, `channel`, `status`, `statusHistory[]` (con quién y motivo), `paymentStatus`, `paymentMethod`, `items[]` (snapshot de precios y modificadores), `subtotal`, `total`, `currency`, `customerName`, `customerPhone` (normalizado), `customerEmail`, `estimatedReadyAt`, `note`, `tableId`, `tableLabel` (snapshot), `deliveryFee`, `delivery` (zona, dirección, depto, referencia), `expectedPayment` (medio y monto en efectivo), `riderId`, `riderName`, `accessTokenHash`, `clientOrderId` ✅ · pendiente: `customerId` (fase 6) |
| `counters` | ✔ | `_id` (`order:{restaurantId}` / `ticket:{restaurantId}:{businessDate}`), `seq` ✅ |
| `customer_addresses` | — | `userId`, `label`, `address`, `reference`, `zoneHint` |
| `push_subscriptions` | — | `userId`, `endpoint`, `keys` |

"Tenant ✔" significa que el documento lleva `restaurantId` y que toda consulta lo filtra. ✅ = implementado.

> **Resuelto en la Fase 3:** los QR de mesa usan `/m/{tableToken}`, independiente del slug: cambiar la dirección del restaurante ya no rompe los QR impresos. Un código se puede regenerar si se filtra.

---

## Reglas de dominio

- **Aislamiento de tenant**: toda consulta sobre una colección con tenant filtra por `restaurantId`, y ese filtro lo aplica el repository, no el controller.
- **Dinero en enteros** en la unidad mínima de la moneda (CLP = pesos, USD = centavos), junto con `currency`. Nunca se usa `float`.
- **Snapshot de precios**: los ítems del pedido copian nombre, precio y modificadores al momento de comprar. Si después cambia el menú, el pedido no cambia.
- **El servidor calcula los totales** a partir de los productos. Lo que manda el cliente es solo la intención: IDs y cantidades.
- **Los pedidos de invitados** se consultan con `accessToken` (link privado), nunca solo con el número de pedido.
- Las transiciones de estado se validan contra la máquina de estados. Una transición inválida devuelve 409.

---

## Hoja de ruta

| Fase | Entregable | Lista cuando… |
| --- | --- | --- |
| **0. Fundaciones** | Monorepo, Dockerfiles, compose (base, dev y prod), Caddy, `/api/health`, Testcontainers, `smoke.sh`, CI | `pnpm stack:up` + `pnpm smoke` pasan y el stack está desplegado vacío en el VPS |
| **1. Identidad y tenants** | Registro y login (sesión en cookies httpOnly, verificación de email para owners), restaurantes, memberships, guards por rol, invitación de staff (primer job `email`) | Un owner crea su restaurante e invita a un cocinero |
| **2. Menú** | Categorías, productos, modificadores, subida de fotos a Garage, menú público | El menú se ve en `/r/{slug}` con fotos |
| **3. Pedidos en mesa** | Mesas, QR (primer job `pdf`), carrito, checkout `dine_in`, tablero en vivo, seguimiento | Un pedido desde el QR aparece en cocina sin recargar |
| **4. Retiro** | Checkout `pickup`, email de confirmación con comprobante PDF, marcado de pago | Flujo completo de retiro con email recibido |
| **5. Delivery** | Zonas, checkout `delivery`, asignación de repartidor, vista del repartidor | Pedido entregado y marcado como pagado contra entrega |
| **6. Clientes y push** | Cuentas de cliente, historial, direcciones, web push | El cliente recibe push al quedar listo su pedido |

Cada fase termina con sus tests, `smoke` actualizado y despliegue al VPS.

---

## Decisiones confirmadas

- **Moneda y país**: CLP / Chile por defecto (configurable por restaurante), zona horaria `America/Santiago`.
- **Una sucursal por restaurante** en el MVP. Una cadena registra cada local como un restaurante.
- **Repartidores**: staff propio del restaurante con rol `rider`. **Asignar un repartidor es opcional**: si el restaurante usa delivery externo o informal, nadie se asigna y el staff cambia los estados (`out_for_delivery` → `delivered`). No hay repartidores de plataforma.
- **Numeración de pedidos, dos números por pedido:**
  - `number`: correlativo **global por restaurante**, nunca se reinicia. Se usa en el comprobante, en soporte y en reportes.
  - `ticketNumber`: correlativo **diario por restaurante**, vuelve a 1 a medianoche en la zona horaria del restaurante. Es el número que se muestra en cocina y al cliente. Más adelante se puede agregar una hora de corte configurable.
  - Ambos salen de contadores atómicos (`$inc`) en la colección `counters`, sin riesgo de duplicados con pedidos simultáneos.
- **Retiro (fase 4):**
  - El dueño activa el retiro por local (`pickupEnabled`, apagado por defecto). Respeta además el interruptor de abierto/cerrado.
  - El email del cliente es **opcional**. Sin email, el comprobante se descarga desde la página de seguimiento.
  - Se pide **para ahora**: al aceptar, el local indica en cuántos minutos estará listo (10, 15, 20, 30, 45 o 60) y el cliente ve la hora estimada.
  - Contra pedidos falsos: límite por IP, máximo 3 pedidos en curso por teléfono y local, y el local acepta cada pedido antes de prepararlo.
  - El comprobante PDF y el email de confirmación se generan **al aceptar** el pedido, no al crearlo: así nunca se envía un comprobante de un pedido que el local rechaza.
  - Se puede marcar **Retirado** un pedido sin pagar; la web avisa y ofrece registrar el pago en ese momento.
- **Delivery (fase 5):**
  - El dueño activa el delivery y define sus zonas (comunas o sectores) con costo de envío y pedido mínimo. Una zona se marca como **zona del local**: el checkout la trae elegida y el cliente puede cambiarla. Sin mapas ni geocodificación.
  - El cliente escribe calle y número, y opcionalmente depto y una referencia.
  - Indica cómo pagará (efectivo, tarjeta POS, transferencia). En efectivo puede decir con cuánto paga y el repartidor ve el vuelto.
  - Al aceptar, el local indica en cuánto llega (20, 30, 45, 60 o 90 min).
  - El repartidor es opcional. Si hay uno asignado, ve solo sus entregas, las marca **En reparto** y **Entregado**, y registra el pago. Sin repartidor, lo hace caja o el dueño.
