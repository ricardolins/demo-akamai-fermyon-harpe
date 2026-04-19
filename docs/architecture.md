# Arquitetura — FoodEdge

## Visão Geral

O FoodEdge demonstra um padrão de arquitetura onde a lógica de negócio é executada na borda da rede (edge), próxima ao usuário, eliminando a necessidade de um backend centralizado para os fluxos mais comuns.

---

## Stack atual (produção)

```
Browser
  │
  ▼
Akamai CDN (cache de assets e APIs)
  │
  ▼
Akamai Functions — spin-app.wasm (WebAssembly)
  ├── GET  /api/menu
  ├── GET  /api/menu-items
  ├── GET  /api/personalization
  ├── GET  /api/geo
  ├── POST /api/orders
  └── GET  /api/orders/:id
  │
  ▼
HarperDB Cloud (us-west4-a-1)
  ├── foodedge.restaurants
  ├── foodedge.menu_items
  ├── foodedge.orders
  └── foodedge.users
```

**URL do edge:** `https://ccb238be-09c1-4260-8e13-8acb59f504a7.fwf.app`

---

## Camadas

### 1. Akamai CDN

**Responsabilidade:** Entrega de assets e cache de respostas de API.

- Assets estáticos (HTML, CSS, JS, imagens) são armazenados em cache nos PoPs da Akamai
- Respostas de API cacheáveis (menu, lista de restaurantes) têm TTL configurado via headers
- Requisições dinâmicas são roteadas para as edge functions

**Regras de cache:**
```
/static/*              → Cache: 7 dias
/api/menu              → Cache: 5 minutos  (Cache-Control: public, max-age=300)
/api/menu-items        → Cache: 2 minutos  (Cache-Control: public, max-age=120)
/api/geo               → Cache: 2 minutos  (Cache-Control: public, max-age=120)
/api/personalization   → Sem cache         (Cache-Control: private, no-store)
/api/orders            → Sem cache         (dinâmico)
```

---

### 2. Akamai Functions (Spin / WebAssembly)

**Responsabilidade:** Lógica de negócio compilada para WebAssembly, executada nos PoPs da Akamai.

O app é um único componente WASM (`spin-app.wasm`) com roteamento interno via `itty-router`. Compilado com `spin build`, deployado com `spin aka deploy`.

#### `GET /api/menu`
- Lista restaurantes por região e culinária
- Resultado cacheável — CDN retém por 5 minutos
- Cache hit: resposta sem chegar ao Harper

#### `GET /api/menu-items`
- Lista itens do cardápio por restaurante
- Cache hit: resposta sem chegar ao Harper

#### `GET /api/personalization`
- Ranking personalizado por histórico e preferências do usuário
- Algoritmo de score calculado no edge (sem ML externo)
- Sempre dinâmico — não cacheável

#### `GET /api/geo`
- Filtra restaurantes por raio usando fórmula Haversine
- Estima tempo de entrega por distância
- Processamento no edge — sem geocoding externo

#### `POST /api/orders` / `GET /api/orders/:id`
- Criação e consulta de pedidos em tempo real
- Escreve e lê do Harper diretamente

---

### 3. HarperDB Cloud

**Responsabilidade:** Armazenamento operacional rápido.

**Schemas:**

```
restaurants   id, name, cuisine, rating, delivery_time_min,
              location { lat, lon }, active, region, tags

menu_items    id, restaurant_id, name, description, price,
              category, available

orders        id, user_id, restaurant_id, items[], status,
              total, created_at, estimated_delivery_at

users         id, name, email, location { lat, lon },
              preferences[], order_history[]
```

---

## Latência medida (produção)

Medições reais na Akamai Functions (`fwf.app`) a partir do Brasil.

| Operação | Cold start | Warm (2ª req+) | Motivo |
|---|---|---|---|
| Menu (cache miss) | ~900ms | **~100ms** | CDN cacheia após 1ª req |
| Menu (cache hit) | — | **< 20ms** | Resposta do PoP, sem Harper |
| Personalização | ~1.2s | **~800ms** | Sempre vai ao Harper (2 queries) |
| Geo | ~900ms | **~100ms** | CDN cacheia por 2 min |
| Criar pedido | ~900ms | **~200ms** | Write no Harper, sem cache |

---

## Por que personalização é mais lenta

A personalização faz **duas chamadas paralelas ao Harper** em cada requisição:
1. `SELECT * FROM restaurants WHERE region = ?`
2. `SELECT * FROM users WHERE id = ?`

Não pode ser cacheada porque o resultado é específico por usuário (`private, no-store`).

**Estado atual da demo:** Harper está em `us-west4` (Califórnia). A Akamai Function está num PoP distante desse endpoint, gerando ~800ms de round trip.

**Caminho para < 50ms na personalização:**

```
Hoje:
  Akamai Function (PoP A) ──800ms──► Harper Cloud (us-west4)

Ideal:
  Akamai Function (PoP A) ──5ms──► Harper replicado no mesmo PoP
```

Isso exige **replicação do Harper entre regiões** — um nó Harper por PoP ou por região Akamai. O HarperDB suporta replicação nativa; bastaria configurar um nó em cada região onde a demo é apresentada.

---

## Fluxo de dados

### Menu (cache hit — caminho feliz)

```
Browser → Akamai CDN [cache HIT] → resposta em < 20ms
```

### Menu (cache miss — primeira carga)

```
Browser → Akamai CDN [miss] → Akamai Function
                                  → Harper (SELECT restaurants)
                                  → resposta + CDN armazena em cache
                                     próximas requisições: < 20ms
```

### Personalização (sempre dinâmico)

```
Browser → Akamai CDN [no-store] → Akamai Function
                                      → Harper (SELECT restaurants) ┐ paralelo
                                      → Harper (SELECT user)        ┘
                                      → ranking calculado no edge (JS)
                                      → resposta personalizada
```

### Pedido

```
Browser → Akamai CDN → Akamai Function
                           → Harper (INSERT order)
                           → confirmação com ID e ETA
```

---

## Princípios de design

1. **Edge-first:** Toda lógica que pode rodar no edge, roda no edge
2. **Cache agressivo:** Dados que mudam pouco são cacheados no CDN — menu, geo, itens
3. **Sem estado no frontend:** O app é apresentação pura, sem lógica de negócio
4. **Cache diferenciado:** Dados públicos (`public`) vs dados de usuário (`private, no-store`)

---

## Comparação: Edge vs Centralizado

| | Backend Central | Edge (esta demo) |
|---|---|---|
| Menu latência | 300–600ms | **< 20ms** (cache hit) |
| Personalização latência | 400–800ms | ~800ms (Harper distante) |
| Personalização c/ Harper local | — | **< 50ms** |
| Single point of failure | Sim | Não |
| Escala automática | Manual | Automática (edge) |
| Custo de infra | Alto | Menor (CDN já pago) |

---

## Roadmap técnico

| Etapa | O que resolve | Impacto |
|---|---|---|
| Harper replicado por região | Personalização < 50ms | Alto |
| Auth JWT no edge | Login sem backend centralizado | Médio |
| Frontend deployado no CDN | Demo sem Vite local | Médio |
| Akamai Property Manager rules | Cache granular por rota | Alto |
