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

> **Windows SmartScreen**: como el `.exe` todavía no está firmado digitalmente, la primera vez Windows puede mostrar "Windows protegió su PC". Haz clic en **Más información → Ejecutar de todas formas**, o antes de abrirlo: clic derecho en el `.exe` → **Propiedades** → marca **Desbloquear** → Aceptar. Ver "Firma del ejecutable".

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

## Firma del ejecutable

**Estado: sin firmar.** El `.exe` ya trae ícono y datos propios (Propiedades → Detalles: "Munch Mate Impresora", versión, © Munch Mate) y no arrastra la firma rota de `node.exe`, pero aún no tiene firma Authenticode. Todo está listo para firmarlo en cuanto haya un certificado (`pnpm sign:exe` y el paso "Sign" de CI).

### Qué ve el usuario mientras no esté firmado

- **SmartScreen la primera vez**: al abrir el `.exe` descargado, "Windows protegió su PC" con editor "Desconocido". Para un computador concreto hay dos salidas:
  - **Más información → Ejecutar de todas formas** (solo la primera vez para ese archivo).
  - Antes de abrirlo: clic derecho en el `.exe` → **Propiedades** → pestaña General → marca **Desbloquear** → Aceptar (o en PowerShell `Unblock-File .\munchmate-impresora.exe`). Quita la marca "descargado de Internet" y SmartScreen ya no pregunta.
- Un `.exe` **construido en el mismo equipo** (`pnpm build:exe`) no tiene la marca de Internet y no muestra SmartScreen.
- El navegador puede advertir al descargarlo ("no se descarga habitualmente"): **Conservar**.
- **Control inteligente de aplicaciones** (Smart App Control, Windows 11 instalado desde cero): si está activado, bloquea los ejecutables sin firma ni reputación **sin** opción de ejecutar de todas formas. Es poco común en un PC de local, pero es el caso en que firmar es imprescindible.
- Al actualizar a otra versión, el archivo nuevo vuelve a pasar por SmartScreen (es otro archivo).

### Firmar no quita el aviso de inmediato

SmartScreen decide por **reputación**, que se acumula por editor (el certificado) y por archivo a medida que la gente lo descarga sin problemas. Con un certificado nuevo el aviso puede seguir apareciendo durante semanas, aunque ya muestra el nombre del editor en vez de "Desconocido". Desde 2024 los certificados **EV** tampoco dan reputación inmediata (antes sí), así que no justifican su costo extra para esto. La firma sí sirve desde el primer día para: integridad (Windows detecta si alguien modificó el `.exe`), el nombre del editor en UAC/SmartScreen, Smart App Control y antivirus que penalizan ejecutables sin firma.

### Opciones de certificado

Desde 2023 la clave privada de un certificado de firma de código tiene que vivir en un token USB o un HSM: ya no se entrega como `.pfx` descargable, por eso casi todas las opciones son "firma en la nube". Costos aproximados (verificar al contratar):

| Opción | Costo aprox. | Requisitos / notas |
| --- | --- | --- |
| **OV comercial con firma en la nube** (SSL.com eSigner, Certum SimplySign, Sectigo/DigiCert vía revendedores) | USD 150–500 al año, más el servicio de firma en la nube si se cobra aparte | Validación de organización (empresa con registro verificable) o, en algunas CA, de persona natural. El editor que aparece es el nombre validado. eSigner y SimplySign instalan un proveedor que deja el certificado en el almacén de Windows (`SIGN_CERT_SHA1`) y SSL.com tiene action para CI. |
| **SignPath Foundation** | Gratis | Proyectos de código abierto: licencia aprobada por OSI, sin componentes privativos, versiones publicadas y build en CI (GitHub Actions) verificado por SignPath. El certificado es de SignPath Foundation: el editor que ve el usuario es "SignPath Foundation", no "Munch Mate". **El repo hoy no tiene `LICENSE`**: habría que licenciarlo antes. |
| **Certum Open Source Code Signing** | ≈ EUR 30–70 el primer año (renovación más barata) | Persona natural, desarrollador de un proyecto de código abierto (mismo problema: falta licencia). Firma en la nube (SimplySign) o tarjeta. El editor aparece como "Open Source Developer, <nombre>". |
| **Azure Artifact Signing** (antes Trusted Signing) | ≈ USD 10 al mes (plan básico) | Validación de identidad de Microsoft, disponible solo en algunos países (organizaciones de EE. UU., Canadá, UE y Reino Unido, y personas de EE. UU. y Canadá, según la última información): **verificar si Chile es elegible** antes de elegirla. Se usa con su action oficial. |

### Cómo activarlo

`pnpm --filter @app/print-agent sign:exe` firma `dist/munchmate-impresora.exe` con signtool (SHA-256, sello de tiempo RFC 3161, descripción "Munch Mate Impresora" y la URL del repo) y lo verifica con `signtool verify /pa`. Toma el certificado del entorno, en este orden:

| Variable | Para qué |
| --- | --- |
| `SIGN_PFX_PATH` + `SIGN_PFX_PASSWORD` | Archivo `.pfx` (la contraseña puede faltar si el PFX no tiene). |
| `SIGN_CERT_SHA1` | Huella SHA-1 de un certificado en el almacén de Windows del usuario: token USB o servicios en la nube cuyo proveedor lo deja ahí (eSigner, SimplySign). Se aceptan espacios y minúsculas tal como la copia `certmgr.msc`. |
| `SIGN_TIMESTAMP_URL` | Servidor de sello de tiempo; por defecto `http://timestamp.digicert.com`. El sello mantiene válida la firma cuando el certificado vence. |
| `SIGNTOOL_PATH` | Opcional; si no, usa el `signtool.exe` del Windows SDK más reciente (`C:\Program Files (x86)\Windows Kits\10\bin\<versión>\x64`). Se instala con el Windows SDK, componente "Signing Tools for Desktop Apps". |

Sin certificado no hace nada y termina bien ("el .exe queda sin firmar"). Con certificado, cualquier error (firma o verificación) termina con error. La contraseña nunca se imprime.

**En CI** (job `print-agent-exe`): crea los secretos del repo `SIGN_PFX_BASE64` (el `.pfx` en base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` en PowerShell) y `SIGN_PFX_PASSWORD`. El paso "Sign" lo decodifica en un archivo temporal, firma, y el archivo se borra siempre. Sin el secreto, el log deja constancia y la release sale sin firmar; con el secreto, si la firma falla el job falla y no se publica nada. Para servicios en la nube (Azure Artifact Signing, SignPath, SSL.com eSigner) ese paso se reemplaza por su action oficial: el workflow trae comentados los datos que pide cada una.

> Ojo: por la regla de 2023, las CA ya no entregan certificados públicos nuevos como `.pfx` exportable. El camino PFX sirve para certificados emitidos antes, para pruebas (un certificado autofirmado no evita SmartScreen) o si el proveedor lo permite; con uno actual lo normal es la action del proveedor en CI, o `SIGN_CERT_SHA1` en un equipo Windows con el token o el cliente de firma en la nube instalado.

## Para desarrolladores

Paquete `@app/print-agent` (TypeScript estricto, CommonJS). Dependencias de ejecución: `socket.io-client`, `@app/types` (protocolo: `printing.ts`) y `@app/utils` (`normalizePairingCode`, `testTicket`/`layoutTicket` para `--test`). Sin módulos nativos.

| Script | Qué hace |
| --- | --- |
| `pnpm --filter @app/print-agent test` | Jest: ESC/POS, cola por impresora y deduplicación, entrada del CLI/config, impresoras Windows y de red, arranque, cliente contra un servidor Socket.IO en memoria. |
| `pnpm --filter @app/print-agent typecheck` / `build` | `tsc` (el build a `dist/tsc` solo valida; lo que se distribuye es el bundle). |
| `pnpm --filter @app/print-agent bundle` | esbuild → `dist/agent.cjs` (todo incluido, ~400 KB). Requiere `@app/types` y `@app/utils` compilados (`pnpm --filter "./packages/*" build`). |
| `pnpm --filter @app/print-agent build:exe` | bundle + Node SEA → `dist/munchmate-impresora.exe` (~90 MB, el `node.exe` que lo construye + el bundle), con ícono y datos de versión propios; al final lo ejecuta con `--version` para comprobar que arranca. **Solo en Windows** (en CI, el job `print-agent-exe` en `windows-latest`). |
| `pnpm --filter @app/print-agent sign:exe` | Firma y verifica el `.exe` con signtool si hay certificado (`SIGN_PFX_PATH`/`SIGN_PFX_PASSWORD` o `SIGN_CERT_SHA1`); sin certificado avisa y termina bien. Ver "Firma del ejecutable". |
| `node scripts/make-icon.mjs` | Regenera `assets/icon.ico` (16, 32, 48 y 256 px) desde `apps/web/public/icons/icon.svg`, con `sharp` del workspace del api. Solo si cambia la marca; el `.ico` está en git y el build no lo regenera. |

- **Probar sin instalar**: `node dist/agent.cjs --help`. Para no tocar tu configuración real usa `MUNCHMATE_AGENT_HOME=<carpeta>`. Contra el api local: `node dist/agent.cjs --server http://localhost:3000 --code <código>` (http solo se acepta con localhost) y luego `--run`.
- **Linux/macOS**: solo impresoras de red, más una impresora de archivo para pruebas: con `MUNCHMATE_PRINT_DIR=<carpeta>` aparece `file:pruebas` ("Archivo (pruebas)") y cada trabajo se guarda como `.bin` con los bytes ESC/POS. La configuración va en `~/.config/munchmate-print-agent/`.
- **Stack local con HTTPS (`https://localhost`, certificado de Caddy)**: Node no confía en la CA local; usa `NODE_EXTRA_CA_CERTS=<ruta al root.crt de Caddy>`.
- **SEA**: `sea-config.json` → `node --experimental-sea-config` genera el blob, se copia `node.exe`, se reescriben sus recursos y `postject` inyecta el blob (`NODE_SEA_BLOB`, fuse `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`).
- **Recursos del `.exe`** (`scripts/build-exe.mjs`, valores en `scripts/exe-metadata.cjs`, con tests): con [`resedit`](https://github.com/jet2jet/resedit-js) (JS puro, sin binarios ni scripts de instalación) se reemplazan el ícono (`assets/icon.ico`), todos los textos de versión (ProductName "Munch Mate Impresora", FileDescription, CompanyName, © año, OriginalFilename, FileVersion/ProductVersion = `version` de `package.json` como `x.y.z.0`; Comments menciona Node.js y su licencia MIT) y se asegura `requestedExecutionLevel asInvoker` en el manifiesto. Se hace **antes** de `postject` (la documentación de Node advierte que editar el binario después de inyectar puede romperlo). Al reescribir el archivo, resedit descarta la firma Authenticode de `node.exe` (que la edición invalidaría de todos modos), así que postject ya no avisa "signature seems corrupted" y Windows lo ve como "sin firmar" en vez de "firma dañada". Se usa `allowShrink`: sin él, la sección de recursos encogida se solapa con `.reloc` y postject (LIEF) lee mal las relocaciones. No se usa el paquete `rcedit`: está deprecado en npm y su repositorio archivado (2026).
- **Firma**: `scripts/sign-exe.mjs`; la lógica pura (origen del certificado, argumentos de signtool, enmascarar la contraseña, elegir el SDK) está en `scripts/signing.cjs`, con tests. Los `scripts/*.spec.cjs` corren en el mismo `pnpm test`.
- **Versión**: `version` de `package.json` = `AGENT_VERSION` (`src/version.ts`, lo verifica un test). En `main`, CI publica la release `print-agent-v<version>` si no existe; súbela para publicar otra. `PRINT_AGENT_DOWNLOAD_URL` del api debe apuntar al asset de esa release.
- **Impresión USB**: `raw-print.ps1` (P/Invoke a `winspool.drv`, documento `RAW`) con `powershell.exe` por ruta absoluta, oculto, 30 s de timeout; impresora, ruta y nombre del documento van en base64 como argumentos (nunca interpolados). Cada trabajo tarda ~1 s extra por compilar el `Add-Type`.
