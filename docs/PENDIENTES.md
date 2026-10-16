# Qué falta (además de los pagos)

> Revisión del 12-10-2026, actualizada con la fase 8. Complementa la hoja de ruta de [PRODUCT.md](PRODUCT.md).

Las 8 fases están implementadas: mesa, retiro, delivery con repartidores, cuentas de cliente, push, mapas con seguimiento y el salón (garzones, cuenta de mesa con propina, descuentos, comandas impresas, exportar ventas y avisos por WhatsApp o SMS). Lo que falta se agrupa en tres frentes, en orden de prioridad.

## 1. Para salir a producción (bloquea el lanzamiento)

| Pendiente | Estado actual | Qué hacer |
| --- | --- | --- |
| **Primer despliegue al VPS** | `deploy.sh` y la CI que publica imágenes existen, pero no hay `.sops.yaml` ni `.env.prod.enc.env` | Crear la llave age, `.sops.yaml`, cifrar el `.env` de producción, DNS de `<dominio>`, `s3.` y `media.`, y correr el checklist de [CLAUDE.MD](../CLAUDE.MD#pre-deploy-checklist) |
| **Backups fuera del VPS** | `backup.sh` guarda los últimos 14 dumps en el mismo disco | Retención 7 diarios + 4 semanales como dice la guía, copia con restic/rclone a otro proveedor, y un `restore.sh` probado en el stack local |
| **Email real** | Mailpit en local; nada configurado para producción | Proveedor SMTP, y SPF, DKIM y DMARC en el dominio (sin eso los correos de verificación caen en spam) |
| **Mapa en el VPS** | `pnpm maps:init` sube ~580 MB a Garage desde la máquina que lo corre | Documentar si se corre desde el VPS o desde local contra `s3.<dominio>`, y cada cuánto se actualiza |
| **Claves de push en producción** | `pnpm push:keys` genera claves VAPID locales | Generarlas una vez para producción y guardarlas cifradas: rotarlas invalida todas las suscripciones |
| **Monitoreo y alertas** | Solo `docker logs` y healthchecks | Como mínimo, un uptime check externo de `/api/health` y alertas de disco; errores con Sentry (o GlitchTip autoalojado) |
| **Playwright en CI** | `pnpm test:web` solo corre a mano contra el stack local | Job de CI que levante el stack y corra la suite (es la única que valida la web real) |
| **WhatsApp en producción** | Los avisos salen por Twilio con texto libre, que WhatsApp solo acepta dentro de las 24 h de una conversación iniciada por el cliente (o en el sandbox) | Aprobar plantillas de WhatsApp en Twilio/Meta para cada aviso y enviarlas con su `ContentSid`; registrar el número de cada local como remitente. El SMS no tiene esa restricción |

## 2. Legal y cuentas (antes de tener clientes reales)

| Pendiente | Por qué |
| --- | --- |
| **Términos y condiciones, y política de privacidad** | Se guardan nombre, teléfono, email, direcciones y ubicación GPS. La Ley 21.719 de datos personales entra en vigencia en diciembre de 2026 y exige informar finalidad, plazos y derechos |
| **Borrar la cuenta y descargar mis datos** | Derechos de supresión y portabilidad. Hoy no existe ninguno de los dos |
| **Retención de pedidos de invitados** | Los pedidos guardan teléfono y dirección sin plazo. Definir cuánto tiempo y anonimizar después |
| **Contrato con los restaurantes** | Quién es responsable de los datos de los clientes (el local) y quién los procesa (la plataforma) |
| **Boleta electrónica (SII)** | Fuera del MVP. El comprobante actual es interno; el local sigue emitiendo la boleta desde su sistema. Si la plataforma cobra, habrá que integrarla |

## 3. Funcionalidades que suelen pedir los restaurantes

Hechas en la fase 8:

- ✅ **Propina sugerida**, solo en mesa (decisión: es para los garzones), aparte de las ventas.
- ✅ **Comandas impresas** en impresora térmica (desde el navegador, 58 u 80 mm, automáticas por dispositivo) y precuenta de mesa.
- ✅ **Cuenta de mesa** con «Llamar al garzón» y «Pedir la cuenta», cobrada desde «Salón».
- ✅ **Descuentos por producto** (porcentaje o precio especial, por días y fechas). Los cupones se descartaron.
- ✅ **Exportar ventas** a Excel (CSV) por pedido, producto o día, para cualquier rango, y versión imprimible.
- ✅ **Avisos por WhatsApp o SMS** con número de envío por local y celular validado del cliente.

Aprobadas para implementar (decisiones del 13-10-2026):

1. **Editar un pedido** (agregar o quitar productos) **solo por el personal** y **solo antes de que la cocina empiece** (estados pendiente o aceptado): después de «Empezar» ya se gastó material.
2. ✅ **Dividir la cuenta de mesa** por productos, en partes iguales o en montos libres, cada parte con su medio de pago. **La arma el garzón en «Salón»**; el teléfono de la mesa ve cuánto se pagó y cuánto falta. (Implementado en la api: plan, pagos parciales con su propina, cierre automático y desglose por medio en los reportes. En la web: diálogo «Cobrar» de «Salón» con las cuatro formas, «Mi cuenta» del teléfono, precuenta y tablero con el desglose.)
3. **Impresión directa ESC/POS** con un **agente local** en el computador de cocina (impresoras USB y de red), vinculado al local con un código. La impresión desde el navegador queda como alternativa. (Backend implementado: vinculación, ajustes por impresora, canal Socket.IO `/print-agents`, comandas, «MODIFICADO», comprobantes de pago y filtro por categoría. Falta el agente `apps/print-agent` y la pantalla «Impresoras» de la web.)

Descartadas por ahora:

- **Pedidos programados** («para las 20:30»): todo sigue siendo para ahora.
- **Calificación del pedido** al entregarlo.
- Fuera del MVP según [PRODUCT.md](PRODUCT.md): varias sucursales, inventario, reservas e idiomas.

## Limitaciones conocidas (ya documentadas)

- Un socket del staff mantiene su suscripción hasta desconectarse, aunque le quiten el rol (al recargar se vuelve a validar).
- El GPS del repartidor se pausa con la pantalla bloqueada, sobre todo en iPhone: la página pide mantenerla encendida.
- Imprimir desde el navegador abre el diálogo de impresión en cada comanda, salvo que Chrome se abra con `--kiosk-printing` en el dispositivo de cocina.
- La cuenta de mesa es visible para cualquiera que tenga el QR de esa mesa (no muestra nombres ni teléfonos). Si un QR se filtra, se regenera desde «Mesas».
- Plano del local: pintar el terreno se hace con el puntero o el dedo (no hay alternativa por teclado), y para pasar una mesa a otro piso hay que quitarla del plano y ubicarla en el otro. En el celular, mientras está activo «Pintar», la grilla no se desplaza al deslizar.
- El seed nunca reemplaza un plano existente: una Pizzería cargada antes de los pisos no trae la «Terraza» hasta `pnpm demo:reset` (o borrar el plano y repetir `pnpm seed:demo`).

## Corregido en esta revisión

- **Mapas en blanco en todos los navegadores**: el CSS de MapLibre pisaba el posicionamiento del contenedor y el mapa quedaba con 0 px de alto (`components/map/base-map.tsx`). La prueba e2e de mapas ahora verifica la altura.
- **«Usar mi ubicación» repetía la posición anterior** durante 30 s (`maximumAge`): ahora pide una lectura nueva.
- **`pnpm maps:init` fallaba en Windows**: `tar` de Git Bash con rutas `C:\…`, y Node sin resolver `s3.localhost`.
- La prueba e2e de mapas nunca había corrido con el mapa cargado en Windows (se saltaba sola por el punto anterior).
- La prueba e2e de cancelar con motivo no podía pasar: leía un `id` que la vista pública del pedido no expone, y su selector del campo «Motivo» era ambiguo.
- Con esto `pnpm test:web` pasa completo (22 de 22). La prueba de reconexión del tablero es intermitente: si falla sola, vuelve a correrla.
