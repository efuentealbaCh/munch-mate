# Agente de impresión de Munch Mate

Programa para el computador del local (normalmente el de la cocina, con Windows) que imprime las comandas y los comprobantes de pago directo en impresoras térmicas, **sin el cuadro de diálogo de impresión** del navegador. Funciona con impresoras **USB** (instaladas en Windows) y **de red** (cable de red o Wi-Fi, puerto 9100), de 58 y 80 mm.

El agente no decide qué imprimir: Munch Mate le manda cada ticket ya armado y el agente solo lo pasa a la impresora. Qué imprime cada impresora (comandas al llegar o al aceptar, categorías, comprobantes, copias, papel) se configura en Munch Mate, en **Ajustes → Impresoras**.

## Instalación (para el dueño del local)

1. En Munch Mate, entra a **Ajustes → Impresoras** y descarga el agente (`munchmate-impresora.exe`).
2. Guárdalo en una carpeta fija del computador (por ejemplo `Documentos\Munch Mate`). No lo dejes en Descargas si limpias esa carpeta: el arranque automático apunta a esa ruta.
3. En la misma página, toca **Vincular equipo**: aparece un código de 8 caracteres (ej. `K7MX-3QPA`), válido por 10 minutos.
4. Haz doble clic en `munchmate-impresora.exe`. Se abre una ventana que pregunta:
   - **Dirección del servidor**: la misma que usas para entrar a Munch Mate (ej. `https://tu-dominio`).
   - **Nombre del equipo**: como lo verás en Munch Mate (ej. `Cocina`). Si lo dejas vacío usa el nombre del computador.
   - **Código de vinculación**: el del paso 3 (da igual si lo escribes con guion, espacios o minúsculas).
   - **¿Iniciar con Windows?** Responde `S` (recomendado): el agente arrancará solo, sin ventana, cada vez que inicies sesión.
   - **¿Agregar una impresora de red?** Solo si tienes impresoras de red (ver más abajo).
5. Vuelve a **Ajustes → Impresoras**: el equipo aparece con sus impresoras. **Actívalas** (todas parten desactivadas), elige el papel y qué imprime cada una, y usa **Imprimir prueba**.

Mientras la ventana del agente esté abierta (o, con arranque automático, mientras la sesión de Windows esté iniciada), las comandas salen solas.

> **Windows SmartScreen**: como el `.exe` todavía no está firmado digitalmente, la primera vez Windows puede mostrar "Windows protegió su PC". Haz clic en **Más información → Ejecutar de todas formas**. (Firmar el ejecutable está pendiente.)

### Impresoras USB

Son las que están **instaladas en Windows** (aparecen en Configuración → Impresoras y escáneres). Instala la impresora con el driver del fabricante (o "Generic / Text Only") antes de abrir el agente; no hace falta compartirla. El agente las detecta solo y revisa cada minuto si conectaste o desconectaste alguna.

Se ignoran las impresoras virtuales (Microsoft Print to PDF, XPS, OneNote, Fax y las que imprimen a un archivo).

### Impresoras de red

Las impresoras térmicas con red reciben los tickets en el **puerto 9100**. Necesitas su IP (sale en la hoja de autoprueba de la impresora; conviene fijarla en el router). Agrégalas en el asistente o con:

```
munchmate-impresora.exe --add-network "Cocina caliente" 192.168.1.50
munchmate-impresora.exe --add-network "Barra" 192.168.1.51:9100
munchmate-impresora.exe --remove-network "Barra"
```

Si el agente está funcionando, toma los cambios en menos de un minuto.

### Probar una impresora sin el servidor

```
munchmate-impresora.exe --list-printers
munchmate-impresora.exe --test "EPSON TM-T20" --paper 80
```

Imprime la misma página de prueba que Munch Mate (tildes, eñe, un producto largo y un monto a la derecha). Si las tildes salen mal, la impresora no usa la página de códigos PC858 (ver "Solución de problemas").

### Arranque con Windows

- `--install-startup` lo activa y `--uninstall-startup` lo quita. No necesita permisos de administrador: se guarda en el registro del usuario (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, valor `MunchMateImpresora`).
- Arranca **sin ventana** a través de un pequeño archivo `iniciar-oculto.vbs` en la carpeta del agente. Si Windows no tiene VBScript (Microsoft lo está retirando como componente opcional), arranca con una ventana de consola: minimízala, no la cierres.
- Arranca al **iniciar sesión** de ese usuario de Windows (no antes): deja el computador con la sesión iniciada.
- Si abres el `.exe` con doble clic cuando ya está funcionando en segundo plano, avisa y no abre un segundo agente (imprimiría todo dos veces).

### Desvincular

- Desde Munch Mate (**Ajustes → Impresoras → Eliminar**): el agente se entera, borra su token y se detiene.
- Desde el computador: `munchmate-impresora.exe --unpair` borra la configuración y el arranque automático. Elimínalo también en Munch Mate para que deje de aparecer.

Para volver a vincularlo, abre el `.exe` con doble clic e ingresa un código nuevo. Si lo eliminaron desde Munch Mate, el asistente ya trae la dirección del servidor, el nombre y las impresoras de red; tras `--unpair` hay que escribirlos de nuevo.

### Dónde están los archivos

Todo queda en `%APPDATA%\MunchMate\print-agent\` (pega esa ruta en el Explorador de archivos):

| Archivo | Qué es |
| --- | --- |
| `config.json` | Servidor, nombre del equipo, impresoras de red y el **token del equipo**. El token es una credencial del local: no compartas este archivo. Si se filtra, elimina el equipo en Munch Mate y vincúlalo de nuevo. |
| `logs\agent.log` | Registro (una línea JSON por evento; rota a los 5 MB y guarda 3 anteriores). No incluye el contenido de los tickets ni el token. |
| `agent.lock` | Evita dos agentes a la vez. Se borra solo. |
| `iniciar-oculto.vbs`, `raw-print.ps1` | Arranque sin ventana e impresión USB; el agente los regenera. |

### Solución de problemas

- **La impresora USB no aparece**: instálala en Windows con su driver (o "Generic / Text Only") y verifica que aparezca en Impresoras y escáneres; luego `--list-printers`. No hace falta compartirla. Si recién la conectaste, espera un minuto o reinicia el agente.
- **Sale el trabajo en la cola de Windows pero no imprime**: la impresora está apagada, sin papel o "sin conexión" en Windows. El agente informa "impreso" cuando Windows aceptó el trabajo; lo que pase después depende de la cola de Windows. Algunos drivers nuevos (v4/XPS) no aceptan datos RAW: usa el driver clásico del fabricante o "Generic / Text Only".
- **Impresora de red "rechazó la conexión" / "no respondió"**: revisa la IP (hoja de autoprueba), que el computador y la impresora estén en la misma red, y que el puerto sea 9100.
- **Tildes o eñes raras**: el agente usa la página de códigos PC858 (`ESC t 19`), la de Epson y la mayoría de las compatibles. Algunas impresoras genéricas numeran sus páginas distinto; por ahora no es configurable.
- **"Este equipo fue desvinculado"**: lo eliminaron en Munch Mate (o el token ya no es válido). Abre el `.exe` y vincúlalo con un código nuevo.
- **"El agente ya está funcionando"**: ya hay uno en segundo plano. Si estás seguro de que no (por ejemplo, tras un corte de luz), borra `agent.lock` o reinicia el computador.
- **PowerShell bloqueado**: la impresión USB usa PowerShell de Windows. Si una política de la empresa lo bloquea (AppLocker, modo de lenguaje restringido), usa impresoras de red.
- **Ver qué pasó**: abre `logs\agent.log`, o ejecuta el `.exe` desde una consola para ver los mensajes en vivo.

## Para desarrolladores

Paquete `@app/print-agent` (TypeScript estricto, CommonJS). Dependencias de ejecución: `socket.io-client`, `@app/types` (protocolo: `printing.ts`) y `@app/utils` (`normalizePairingCode`, `testTicket`/`layoutTicket` para `--test`). Sin módulos nativos.

| Script | Qué hace |
| --- | --- |
| `pnpm --filter @app/print-agent test` | Jest: ESC/POS, cola por impresora y deduplicación, entrada del CLI/config, impresoras Windows y de red, arranque, cliente contra un servidor Socket.IO en memoria. |
| `pnpm --filter @app/print-agent typecheck` / `build` | `tsc` (el build a `dist/tsc` solo valida; lo que se distribuye es el bundle). |
| `pnpm --filter @app/print-agent bundle` | esbuild → `dist/agent.cjs` (todo incluido, ~400 KB). Requiere `@app/types` y `@app/utils` compilados (`pnpm --filter "./packages/*" build`). |
| `pnpm --filter @app/print-agent build:exe` | bundle + Node SEA → `dist/munchmate-impresora.exe` (~90 MB, el `node.exe` que lo construye + el bundle). **Solo en Windows** (en CI, el job `print-agent-exe` en `windows-latest`). |

- **Probar sin instalar**: `node dist/agent.cjs --help`. Para no tocar tu configuración real usa `MUNCHMATE_AGENT_HOME=<carpeta>`. Contra el api local: `node dist/agent.cjs --server http://localhost:3000 --code <código>` (http solo se acepta con localhost) y luego `--run`.
- **Linux/macOS**: solo impresoras de red, más una impresora de archivo para pruebas: con `MUNCHMATE_PRINT_DIR=<carpeta>` aparece `file:pruebas` ("Archivo (pruebas)") y cada trabajo se guarda como `.bin` con los bytes ESC/POS. La configuración va en `~/.config/munchmate-print-agent/`.
- **Stack local con HTTPS (`https://localhost`, certificado de Caddy)**: Node no confía en la CA local; usa `NODE_EXTRA_CA_CERTS=<ruta al root.crt de Caddy>`.
- **SEA**: `sea-config.json` → `node --experimental-sea-config` genera el blob, se copia `node.exe` y `postject` inyecta el blob (`NODE_SEA_BLOB`, fuse `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`). La firma Authenticode original de `node.exe` queda inválida (postject avisa "signature seems corrupted"): es esperado; firmar el `.exe` y ponerle ícono/metadatos propios está pendiente.
- **Versión**: `version` de `package.json` = `AGENT_VERSION` (`src/version.ts`, lo verifica un test). En `main`, CI publica la release `print-agent-v<version>` si no existe; súbela para publicar otra. `PRINT_AGENT_DOWNLOAD_URL` del api debe apuntar al asset de esa release.
- **Impresión USB**: `raw-print.ps1` (P/Invoke a `winspool.drv`, documento `RAW`) con `powershell.exe` por ruta absoluta, oculto, 30 s de timeout; impresora, ruta y nombre del documento van en base64 como argumentos (nunca interpolados). Cada trabajo tarda ~1 s extra por compilar el `Add-Type`.
