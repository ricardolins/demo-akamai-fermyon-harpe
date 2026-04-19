# Arquitetura — FoodEdge

## Visão Geral

O FoodEdge demonstra um padrão de arquitetura onde a lógica de negócio é executada na borda da rede (edge), próxima ao usuário, eliminando a necessidade de um backend centralizado para os fluxos mais comuns.

---

## Camadas

### 1. Akamai CDN

**Responsabilidade:** Entrega de assets e cache de respostas de API.

- Assets estáticos (HTML, CSS, JS, imagens) são armazenados em cache nos PoPs da Akamai
- Respostas de API cacheáveis (menu, lista de restaurantes) têm TTL configurado via headers
- Requisições dinâmicas são roteadas para as edge functions

**Regras de cache:**
```
/static/*          → Cache: 7 dias
/api/menu/*        → Cache: 5 minutos (varia por região)
/api/restaurants/* → Cache: 2 minutos
/api/orders/*      → Sem cache (dinâmico)
/api/user/*        → Sem cache (personalizado)
```

---

### 2. Edge Functions (Fermyon/Spin)

**Responsabilidade:** Lógica de negócio executada na borda.

Cada função é um módulo independente compilado para WebAssembly:

#### `menu`
- Lista restaurantes disponíveis por geolocalização
- Retorna cardápio com preços e disponibilidade
- Lê do HarperDB local ao PoP

#### `orders`
- Cria novos pedidos
- Consulta status de pedido existente
- Escreve/lê do HarperDB em tempo real

#### `personalization`
- Calcula recomendações baseadas em:
  - Histórico de pedidos do usuário
  - Popularidade regional (dados agregados no edge)
  - Hora do dia e dia da semana
- Sem round-trip ao datacenter central

#### `geo`
- Determina raio de entrega com base no IP/coordenadas
- Filtra restaurantes dentro do raio
- Estima tempo de entrega por zona

---

### 3. HarperDB

**Responsabilidade:** Armazenamento operacional rápido e distribuído.

**Schemas:**

```
restaurants
  id, name, cuisine, rating, delivery_time_min,
  location { lat, lon }, active, region

menu_items
  id, restaurant_id, name, description, price,
  category, available, image_url

orders
  id, user_id, restaurant_id, items[], status,
  total, created_at, estimated_delivery_at

users
  id, name, email, location { lat, lon },
  preferences [], order_history []
```

**Padrão de acesso:**
- Leituras: direto do PoP mais próximo (< 5ms)
- Escritas de pedidos: replicadas para garantir consistência
- Dados de menu: atualizados do restaurante, replicados nos PoPs

---

## Fluxo de Dados

### Carregar menu (caminho cacheável)

```
Browser → Akamai CDN → [cache hit] → resposta imediata
                     → [cache miss] → Edge Function menu
                                         → HarperDB (local)
                                         → resposta + cache
```

### Criar pedido (caminho dinâmico)

```
Browser → Akamai CDN → Edge Function orders
                           → HarperDB (write)
                           → confirmação ao usuário
```

### Personalização

```
Browser → Akamai CDN → Edge Function personalization
                           → HarperDB (user preferences)
                           → algoritmo local no edge
                           → lista personalizada
```

---

## Princípios de design

1. **Edge-first:** Toda lógica que pode rodar no edge, roda no edge
2. **Cache agressivo:** Dados que mudam pouco são cacheados no CDN
3. **Dados locais:** HarperDB co-localizado com as edge functions
4. **Sem estado no frontend:** O frontend é apenas apresentação

---

## Latência esperada

| Operação | Latência alvo |
|---|---|
| Carregar página (cache) | < 20ms |
| Listar restaurantes (cache) | < 50ms |
| Listar restaurantes (miss) | < 150ms |
| Recomendações personalizadas | < 100ms |
| Criar pedido | < 200ms |
| Status do pedido | < 80ms |

---

## Comparação: Edge vs Centralizado

| | Backend Central | Edge (esta demo) |
|---|---|---|
| Latência média | 300–600ms | 50–150ms |
| Single point of failure | Sim | Não |
| Personalização regional | Difícil | Natural |
| Custo de infra | Alto | Menor (CDN já pago) |
| Complexidade operacional | Maior | Menor |
