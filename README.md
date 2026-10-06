# munch-mate

Plataforma SaaS multi-restaurante para pedidos por QR en mesa, retiro y delivery.

- Producto, alcance y hoja de ruta: [docs/PRODUCT.md](docs/PRODUCT.md)
- Stack, reglas y convenciones técnicas: [CLAUDE.MD](CLAUDE.MD)

## Requisitos

- Node 24+ y pnpm 12 (`npm i -g pnpm`)
- Docker con Compose v2
- En Windows: ejecutar los scripts desde **Git Bash** (o WSL)

## Arranque rápido

```bash
pnpm install
pnpm env:init        # crea .env con secretos aleatorios
pnpm infra:up        # mongo, valkey, garage y mailpit en Docker
pnpm infra:init      # inicializa Garage (solo la primera vez)
pnpm dev             # web :3100 · api :3000 · workers
```

## Antes de desplegar

```bash
pnpm test && pnpm test:int && pnpm test:e2e
pnpm infra:down
pnpm stack:up        # stack de producción completo en https://localhost
pnpm smoke           # debe terminar con "all checks passed"
pnpm stack:down
```
