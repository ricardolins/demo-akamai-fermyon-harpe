# FoodEdge — Food Delivery Demo

**Stack:** Akamai CDN + Edge Functions (Fermyon/Spin) + HarperDB

Uma demo de delivery de comida que demonstra como mover lógica de negócio para a edge da rede, reduzindo latência e dependência de backend centralizado.

---

## O que esta demo demonstra

| Capacidade | Como é demonstrada |
|---|---|
| Baixa latência | Menu e restaurantes servidos do edge (< 50ms) |
| Personalização no edge | Recomendações por geolocalização e histórico |
| Dados operacionais rápidos | HarperDB como camada de dados local ao edge |
| Sem backend centralizado | Toda lógica de negócio nas edge functions |

---

## Arquitetura

```
Usuário
  │
  ▼
Akamai CDN
  ├── Cache: assets estáticos, menu, catálogo
  │
  ▼
Edge Functions (Fermyon/Spin)
  ├── menu          → catálogo de restaurantes e pratos
  ├── orders        → criação e status de pedidos
  ├── personalization → recomendações por região/perfil
  └── geo           → detecção de localização e raio de entrega
  │
  ▼
HarperDB (operacional)
  ├── restaurants   → dados dos restaurantes
  ├── orders        → pedidos em tempo real
  └── users         → perfis e preferências
```

---

## Estrutura do Projeto

```
demo-akamai-fermyon-harpe/
├── frontend/           # Interface da aplicação (HTML/TS simples)
│   ├── public/         # Assets estáticos (CDN-cached)
│   └── src/
│       ├── components/ # Componentes de UI
│       ├── pages/      # Páginas da aplicação
│       └── lib/        # Utilitários e API client
│
├── functions/          # Edge functions (Fermyon/Spin)
│   ├── menu/           # Catálogo de restaurantes e pratos
│   ├── orders/         # Criação e consulta de pedidos
│   ├── personalization/# Recomendações no edge
│   └── geo/            # Lógica de geolocalização
│
├── harper/             # Integração com HarperDB
│   ├── schema/         # Definição dos modelos de dados
│   ├── seeds/          # Dados iniciais para demo
│   └── lib/            # Cliente e utilitários
│
└── docs/               # Documentação e roteiro da demo
    ├── architecture.md # Arquitetura detalhada
    └── demo-script.md  # Roteiro para apresentação
```

---

## Começando

```bash
# 1. Configurar HarperDB
cd harper && npm install
node seeds/seed.js

# 2. Deploy das edge functions
cd functions/menu && spin build && spin up

# 3. Servir o frontend
cd frontend && npm install && npm run dev
```

---

## Fluxo principal da demo

1. Usuário acessa o site → assets servidos do CDN (edge cache)
2. App detecta localização → geo function determina raio de entrega
3. Menu carregado → edge function busca do HarperDB mais próximo
4. Personalização aplicada → recomendações sem round-trip ao datacenter
5. Pedido criado → orders function persiste no HarperDB em tempo real

---

## Stack

- **Akamai CDN** — entrega de assets e cache de APIs
- **Fermyon/Spin** — runtime de edge functions (WebAssembly)
- **HarperDB** — banco de dados operacional distribuído
- **TypeScript** — lógica do frontend e funções utilitárias
