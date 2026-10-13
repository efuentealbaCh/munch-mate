# Munch Mate

**Pedidos para restaurantes: desde la mesa, para retirar o a domicilio, con la cocina y el cliente conectados en tiempo real.**

Munch Mate es una plataforma web para que cualquier restaurante, sanguchería, pizzería o café reciba y gestione sus pedidos sin instalar nada. El cliente pide desde su teléfono, el pedido aparece al instante en el tablero del local y el cliente ve cómo avanza hasta que lo recibe.

Un solo sistema atiende a muchos restaurantes a la vez. Cada local tiene su menú, su equipo y sus pedidos, completamente separados del resto.

> Este documento describe el producto terminado. Las reglas técnicas están en [`CLAUDE.MD`](CLAUDE.MD) y el detalle del modelo y la hoja de ruta en [`docs/PRODUCT.md`](docs/PRODUCT.md).

---

## El problema que resuelve

En muchos locales, tomar un pedido todavía significa:

- un garzón que va y vuelve con una libreta;
- pedidos por WhatsApp que se pierden entre mensajes;
- una cocina que no sabe qué viene después;
- clientes que preguntan "¿falta mucho?" una y otra vez.

Munch Mate reemplaza todo eso por un flujo único: **el cliente pide, la cocina lo ve, el cliente sigue su pedido.** Todo desde un navegador, sin descargar aplicaciones.

---

## Tres formas de pedir

| Canal | Cómo empieza | Qué necesita el cliente | Cómo paga |
| --- | --- | --- | --- |
| 🍽️ **En la mesa** | Escanea el código QR pegado en su mesa | Nada: la mesa ya lo identifica | En el local |
| 🛍️ **Para retirar** | Entra al menú del local (`/r/nombre-del-local`) | Nombre y teléfono | Al retirar |
| 🛵 **Delivery** | Entra al menú del local | Nombre, teléfono y dirección dentro de una zona de reparto | Contra entrega |

El pago se hace **en el local o al recibir el pedido** (efectivo, tarjeta en POS o transferencia), y el personal lo registra en el sistema. No hay pagos en línea en esta versión.

En la mesa, los pedidos se suman en **la cuenta de la mesa**: se pide varias veces y se paga todo junto al final, con propina sugerida.

---

## La experiencia del cliente

1. **Ve el menú** con fotos, descripciones y precios, ordenado por categorías. Los productos en promoción muestran el precio rebajado con el normal tachado.
2. **Arma su pedido**: elige tamaños, agregados o variantes ("Tamaño: Normal o XL", "Agregados: palta, queso…"). Lo que está agotado se ve, pero no se puede pedir.
3. **Confirma**, sin crear cuenta. Si la conexión falla y vuelve a enviar, el pedido no se duplica.
4. **Sigue su pedido en vivo** con un número grande y fácil de cantar ("#12") y los pasos del avance:

   ```
   Pendiente → Aceptado → En preparación → Listo → Servido / Retirado / Entregado
   ```

   La página se actualiza sola. Si el local rechaza el pedido, el cliente ve el motivo.
5. **Puede cancelar** mientras el pedido todavía no entra a cocina.
6. **Recibe un email de confirmación** con un comprobante en PDF (retiro y delivery).
7. **Si quiere, recibe avisos por WhatsApp o SMS** (retiro y delivery): cuando el local acepta el pedido, cuando está listo o sale a reparto. Basta marcar la opción y usar un celular.
8. **Si quiere, crea una cuenta** para guardar su historial y sus direcciones, y recibir una notificación en el teléfono cuando su pedido está listo.
9. **En delivery, ve al repartidor en el mapa** mientras va en camino, y marca su dirección con un pin.

### En la mesa

- **Llamar al garzón** con un botón desde el mismo QR.
- **Mi cuenta**: el detalle de todo lo que pidió la mesa, sumado.
- **Pedir la cuenta** con la propina sugerida (10 % por defecto), otro monto o sin propina. Es voluntaria y se confirma con el garzón al pagar.

El seguimiento funciona con un **link privado** que solo tiene quien hizo el pedido. Nadie puede ver un pedido ajeno adivinando su número.

---

## La experiencia del restaurante

### Tablero de pedidos en vivo

El corazón del local. Los pedidos nuevos aparecen **sin recargar la página**, con un aviso sonoro. Cada tarjeta muestra el número del día, la mesa o el tipo de pedido, el detalle con sus variantes, el total y si ya está pagado.

Con un toque, el personal avanza el pedido: **aceptar, rechazar (con motivo), en preparación, listo, servido**. El sistema solo ofrece los pasos válidos. Si dos personas tocan el mismo pedido a la vez, solo gana una, y la otra ve el cambio.

Un interruptor **"Recibiendo pedidos"** abre o cierra el local en un segundo: con el local cerrado, el menú se sigue viendo, pero no se puede pedir.

**Comandas impresas**: el tablero imprime la comanda de cada pedido en la impresora térmica del local (58 u 80 mm), con un botón o sola al llegar o al aceptar el pedido. Cada dispositivo elige si imprime, así que solo la tablet de cocina lo hace.

### Salón

La pantalla de los garzones. Muestra las mesas con cuenta abierta, con los llamados y las cuentas pedidas primero y un aviso sonoro. Desde ahí se marca el llamado como atendido, se imprime la **precuenta** (con la propina sugerida, como voluntaria) y se **cobra la mesa**: medio de pago y propina, y todos los pedidos de la mesa quedan pagados.

### Ventas

- **Resumen del día** para el cierre de caja: total vendido, por canal y medio de pago, pendiente de cobro, más vendidos, **propinas** (aparte de las ventas) y **descuentos** dados.
- **Cualquier rango de fechas**, con una fila por día.
- **Exportar a Excel** (pedidos, productos o días) y **versión imprimible**.

### Menú

- Categorías, productos con foto, precio y descripción.
- **Grupos de opciones reutilizables**: un grupo "Bebida del combo" se define una vez y se usa en todos los productos que lo necesiten. Si se cambia, se actualiza en todos.
- Dos interruptores por producto: **Agotado** (se ve, pero no se puede pedir) y **Oculto** (no aparece en el menú).
- **Descuentos por producto**: un porcentaje o un precio especial, todos los días o solo algunos (ej. «Martes de pizza»), y entre fechas si se quiere. El pedido guarda el precio normal y el cobrado.
- Una vista rápida de **disponibilidad** para que caja o cocina marquen productos agotados durante el servicio sin tocar nada más.
- Las fotos se suben desde el teléfono. El sistema las optimiza y les quita la ubicación GPS y otros datos privados.

### Mesas y códigos QR

- Se crean las mesas ("Mesa 1", "Terraza 2", "Barra") de a una o varias juntas.
- Cada mesa tiene su propio QR. **Un PDF listo para imprimir** reúne todos los códigos del local.
- Si un código se filtra o se copia, se regenera y el anterior deja de funcionar.
- Los QR no dependen del nombre del local: cambiar la dirección web del restaurante no obliga a reimprimirlos.

### Retiro y delivery

- **Zonas de reparto** como comunas o sectores, cada una con su costo de envío y pedido mínimo, y opcionalmente **dibujadas en un mapa** propio (sin costo por uso). El pin del cliente elige la zona.
- **Repartidores propios** (opcional): el local les asigna entregas y ellos las marcan como entregadas desde su teléfono, compartiendo su ubicación mientras van en camino. Si el local usa reparto externo, el personal avanza los estados a mano.
- **Avisos por WhatsApp o SMS** desde el número del local, para los clientes que los pidan.

### Equipo y permisos

El dueño invita a su equipo por email y le asigna uno o más roles:

| Rol | Puede |
| --- | --- |
| **Dueño** | Todo: perfil del local, menú, precios, mesas, zonas de reparto y equipo |
| **Caja** | Aceptar o rechazar pedidos, registrar pagos, marcar productos agotados |
| **Cocina** | Ver la cola de pedidos, cambiar estados de preparación, marcar agotados |
| **Garzón** | Atender las mesas desde «Salón»: llamados, pedidos de mesa y cobrar la cuenta con la propina |
| **Repartidor** | Ver sus entregas y marcarlas como entregadas |

Un restaurante siempre tiene al menos un dueño: el sistema no permite quedarse sin ninguno.

### Numeración pensada para la operación

Cada pedido lleva dos números:

- **Número del día** (#1, #2, #3…): vuelve a empezar cada medianoche en la zona horaria del local. Es el que se canta en cocina y ve el cliente.
- **Número de pedido**: correlativo permanente del local, para comprobantes, soporte y reportes.

Ningún número se repite, aunque entren muchos pedidos a la vez.

---

## Hecho para Chile, y para el teléfono

- Todo el texto en español de Chile; pesos chilenos (CLP) y hora de Santiago por defecto, configurables por local.
- Diseñado primero para teléfonos: el personal trabaja con el celular en la mano.
- Funciona en cualquier navegador moderno, sin instalar aplicaciones.

---

## Seguridad y confianza

- **Los precios los calcula siempre el servidor** a partir del menú vigente. El cliente solo indica qué quiere; no puede alterar un total.
- **Cada pedido guarda una foto de los precios** del momento en que se hizo: si después cambia el menú, los pedidos anteriores no cambian.
- **Aislamiento entre restaurantes**: ningún local puede ver ni adivinar datos de otro.
- Sesiones en cookies protegidas, contraseñas cifradas con argon2id, verificación de email para dueños y protección contra intentos masivos de acceso.
- Los comprobantes y hojas de QR se guardan en almacenamiento privado.
- La cuenta de una mesa solo muestra lo pedido, sin nombres ni teléfonos. Los avisos por WhatsApp o SMS exigen un celular válido y nunca se registran en los logs.

---

## Qué no incluye (por ahora)

- Pagos en línea con tarjeta.
- Boleta o factura electrónica del SII. El comprobante es un documento interno, no tributario.
- Cupones de descuento (solo descuentos por producto).
- Pedidos programados para más tarde, dividir la cuenta de una mesa o editar un pedido ya aceptado.
- Varias sucursales bajo un mismo restaurante (cada local se registra por separado).
- Control de inventario y reservas.
- Otros idiomas.
