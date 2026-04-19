# Roteiro da Demo — FoodEdge

**Duração estimada:** 15–20 minutos  
**Público:** Times técnicos e executivos de tecnologia

---

## Abertura (2 min)

> "Hoje vou mostrar como um app de delivery pode ser construído de forma que a experiência do usuário aconteça inteiramente na borda da rede — sem um backend centralizado no caminho crítico."

Mostrar o diagrama de arquitetura em `docs/architecture.md`.

---

## Parte 1: Frontend no CDN (3 min)

**O que mostrar:**
1. Abrir o app no browser
2. Abrir DevTools → Network
3. Mostrar que assets (JS, CSS, imagens) têm `X-Cache: HIT`
4. Mostrar o tempo de resposta < 20ms

**Ponto de destaque:**
> "O usuário já tem a interface carregada antes de qualquer chamada ao nosso servidor. A Akamai entregou tudo do PoP mais próximo."

---

## Parte 2: Menu no Edge (4 min)

**O que mostrar:**
1. Listar restaurantes na tela
2. Inspecionar a chamada `/api/menu` no Network
3. Mostrar header `X-Edge-Region: sa-east-1` (ou a região do PoP)
4. Mostrar latência < 50ms

**Ponto de destaque:**
> "O catálogo de restaurantes foi retornado por uma edge function rodando em WebAssembly no PoP mais próximo do usuário — não em São Paulo, não em Virgínia. No PoP."

**Variação para impressionar:**
- Mostrar a mesma chamada sem cache (primeira vez): ainda < 150ms porque o HarperDB também está no edge
- Recarregar: cai para < 20ms com cache do CDN

---

## Parte 3: Personalização no Edge (4 min)

**O que mostrar:**
1. Entrar como um usuário com histórico (seed inclui histórico pré-definido)
2. Mostrar que a lista de restaurantes muda — restaurantes favoritos sobem
3. Inspecionar `/api/personalization` — resposta em < 100ms
4. Mostrar no código (`functions/personalization/`) que o algoritmo roda no edge

**Ponto de destaque:**
> "Isso não é um AB test simples. É um algoritmo de ranking rodando no edge, usando dados do usuário armazenados no HarperDB local ao PoP. Sem chamada ao datacenter."

---

## Parte 4: Pedido em Tempo Real (3 min)

**O que mostrar:**
1. Fazer um pedido
2. Mostrar a chamada `POST /api/orders` — status 201 em < 200ms
3. Consultar status do pedido — resposta em < 80ms
4. Mostrar no HarperDB Studio (ou CLI) que o pedido foi criado

**Ponto de destaque:**
> "O pedido foi persistido no HarperDB co-localizado com a edge function. A confirmação chegou em menos de 200ms, sem passar por nenhum backend na nuvem."

---

## Encerramento (2 min)

**Resumo dos números:**
| O que aconteceu | Tempo |
|---|---|
| Página carregada (CDN cache) | < 20ms |
| Menu listado (edge + HarperDB) | < 50ms |
| Recomendação personalizada | < 100ms |
| Pedido criado e confirmado | < 200ms |

> "A diferença para uma arquitetura centralizada tradicional? O mesmo fluxo levaria 300–600ms só para o menu. A personalização exigiria uma chamada extra a um serviço de ML centralizado. E o pedido dependeria de disponibilidade de uma região específica."

---

## Perguntas frequentes

**"E a consistência dos dados?"**
> O HarperDB replica entre PoPs. Para dados de pedido, usamos escrita confirmada antes de responder ao usuário. Para menu e personalização, eventual consistency é suficiente — um restaurante desatualizado por 5 minutos não impacta o negócio.

**"Quanto custa adicionar uma nova edge function?"**
> É um módulo WebAssembly independente. Deploy via Fermyon/Spin — mesmo fluxo de CI/CD de qualquer serviço. O custo incremental é mínimo.

**"E autenticação?"**
> JWT verificado na edge function, chave pública em cache no PoP. Sem round-trip para validar token.
