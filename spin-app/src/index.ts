// ============================================================
// ARQUIVO PRINCIPAL DA EDGE FUNCTION
//
// Este arquivo é compilado para WebAssembly (.wasm) pelo webpack
// e roda dentro da Akamai Functions (plataforma Spin/Fermyon).
//
// Em vez de rodar em um servidor Node.js centralizado, este código
// roda nos PoPs (pontos de presença) da Akamai ao redor do mundo,
// próximo do usuário — isso reduz a latência drasticamente.
// ============================================================

// AutoRouter é da biblioteca "itty-router" — um roteador HTTP leve
// compatível com ambientes WebAssembly (não usa Node.js internamente).
// Ele mapeia URLs e métodos HTTP para funções handler.
import { AutoRouter } from 'itty-router';

// "declare const" não cria variáveis — apenas avisa ao TypeScript que
// essas constantes existirão em tempo de execução. Quem as injeta é o
// webpack DefinePlugin (ver webpack.config.js), substituindo o texto
// __HARPER_URL__ pelo valor real da string antes de compilar.
declare const __HARPER_URL__: string;
declare const __HARPER_USER__: string;
declare const __HARPER_PASS__: string;

// Lista de IPs que têm permissão para acessar qualquer rota da API.
// Qualquer requisição de outro IP recebe 403 Forbidden.
// IPv4 (177.181.2.218) e IPv6 (2804:...) do mesmo usuário,
// pois a Akamai pode usar qualquer um dependendo da rede.
const ALLOWED_IPS = [
  '177.181.2.218',
  '2804:14d:783a:815a:f5fd:666c:7d67:b0ff',
];

// AutoRouter aceita um objeto de configuração com hooks "before" e "after".
// O hook "before" é um array de funções que rodam ANTES de qualquer rota.
// Se uma função do "before" retornar um Response, a requisição para aí —
// as rotas definidas abaixo nem chegam a executar.
let router = AutoRouter({
  before: [(req): Response | undefined => {
    // A Akamai injeta o IP real do cliente no header "true-client-ip".
    // É mais confiável que x-forwarded-for, que pode ser forjado.
    // O operador ?? encadeia fallbacks: tenta o primeiro, se for null/undefined tenta o próximo.
    const ip = req.headers.get('true-client-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? '';

    // Se o IP não está na lista, bloqueia com 403.
    // Retornar um Response aqui interrompe o pipeline — as rotas abaixo não rodam.
    if (!ALLOWED_IPS.includes(ip)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Retornar undefined significa "pode continuar" — o router passa para a próxima etapa.
    return undefined;
  }],
});

// ============================================================
// FUNÇÕES DE ACESSO AO HARPERDB
// ============================================================

// Monta as credenciais de autenticação para o Harper.
// Harper usa autenticação HTTP Basic: "usuário:senha" em Base64.
// btoa() converte string para Base64 — função nativa do browser/WASM.
// O prefixo "Basic " é obrigatório pelo protocolo HTTP.
function getHarperAuth(): { url: string; auth: string } {
  return {
    url: __HARPER_URL__,
    auth: `Basic ${btoa(`${__HARPER_USER__}:${__HARPER_PASS__}`)}`,
  };
}

// Função genérica para executar qualquer SQL no Harper via HTTP.
// O <T> é um "generic" do TypeScript — permite tipar o retorno dinamicamente.
// Exemplo: queryHarper<Restaurant>(...) retorna Promise<Restaurant[]>
async function queryHarper<T>(sql: string): Promise<T[]> {
  const { url, auth } = getHarperAuth();

  // Harper expõe uma API REST. Toda operação é um POST para "/".
  // O corpo é JSON com "operation" e "sql" — Harper não usa endpoint /sql separado.
  const res = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ operation: 'sql', sql }),
  });

  // res.ok é true quando o status HTTP é 200–299.
  // Qualquer erro do Harper (autenticação, SQL inválido) lança uma exceção
  // que será capturada nos blocos try/catch de cada rota.
  if (!res.ok) throw new Error(`Harper ${res.status}`);
  return res.json();
}

// Função para inserir um registro no Harper.
// Diferente do SQL, usa a operação "insert" nativa do Harper
// que é mais eficiente para inserts simples (sem SQL parsing).
async function insertHarper(table: string, record: object): Promise<void> {
  const { url, auth } = getHarperAuth();
  const res = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    // schema = banco de dados, table = tabela, records = array de objetos a inserir
    body: JSON.stringify({ operation: 'insert', schema: 'foodedge', table, records: [record] }),
  });
  if (!res.ok) throw new Error(`Harper insert ${res.status}`);
}

// ============================================================
// FUNÇÕES UTILITÁRIAS
// ============================================================

// Lê o header que identifica a região do PoP da Akamai onde a requisição está rodando.
// Cada plataforma de edge tem seu próprio header — esta função tenta os mais comuns.
// O resultado aparece no frontend como "X-Edge-Region" para mostrar de qual PoP veio.
function edgeRegion(req: Request): string {
  return req.headers.get('x-aka-region')        // Akamai Functions
    ?? req.headers.get('fly-region')             // Fly.io (não usado aqui, mas estava no dev)
    ?? req.headers.get('x-vercel-id')?.split(':')[0]  // Vercel Edge
    ?? 'edge';
}

// Helper para criar respostas JSON com status e headers customizados.
// Sem isso, cada rota precisaria repetir new Response(JSON.stringify(...), {...}) em todo lugar.
// O terceiro parâmetro "extra" permite adicionar headers como Cache-Control.
function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ============================================================
// ALGORITMO HAVERSINE — distância entre dois pontos na Terra
// ============================================================
//
// A Terra é uma esfera. Calcular distância entre dois pontos
// (lat/lon) não é simples como Pitágoras porque a superfície é curva.
// A fórmula Haversine resolve isso com trigonometria esférica.
//
// Parâmetros: lat1/lon1 = ponto A, lat2/lon2 = ponto B (em graus)
// Retorno: distância em quilômetros
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raio médio da Terra em km

  // Converte diferenças de graus para radianos (Math.sin/cos trabalham em radianos)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  // "a" é o quadrado do semi-ângulo central entre os dois pontos.
  // ** é operador de exponenciação (x ** 2 = x²)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;

  // atan2 calcula o ângulo central; multiplicado pelo diâmetro dá a distância do arco.
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// ROTAS HTTP
// ============================================================

// GET /api/menu
// Lista restaurantes por região e tipo de culinária.
// Resultado é cacheável: o CDN da Akamai guarda por 5 minutos (max-age=300).
// Na prática: primeira requisição vai ao Harper (~900ms), as seguintes
// são respondidas pelo CDN em < 20ms sem sequer chegar aqui.
router.get('/api/menu', async (req) => {
  const url = new URL(req.url);

  // searchParams.get() lê parâmetros da query string (?region=sa-east-1)
  // O ?? fornece valor padrão caso o parâmetro não seja enviado.
  const region = url.searchParams.get('region') ?? 'sa-east-1';
  const cuisine = url.searchParams.get('cuisine');

  // Construção dinâmica do SQL — começa com filtro obrigatório (active + region)
  // e adiciona cuisine apenas se foi passado.
  // ATENÇÃO: em produção real isso seria vulnerável a SQL injection —
  // nesta demo os valores vêm do frontend controlado, não de input livre.
  let sql = `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`;
  if (cuisine) sql += ` AND cuisine = '${cuisine}'`;
  sql += ' ORDER BY rating DESC';

  try {
    const data = await queryHarper(sql);
    // Cache-Control: public → CDN pode cachear (dados públicos, não personalizados)
    // max-age=300 → válido por 5 minutos (300 segundos)
    // X-Edge-Region → header customizado que o frontend lê para mostrar de qual PoP veio
    return json(data, 200, { 'Cache-Control': 'public, max-age=300', 'X-Edge-Region': region });
  } catch {
    // 503 Service Unavailable = servidor de destino indisponível
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// GET /api/menu-items?restaurant_id=xxx
// Lista os itens do cardápio de um restaurante específico.
// Também cacheável: max-age=120 (2 minutos) — pode mudar mais frequentemente que o menu.
router.get('/api/menu-items', async (req) => {
  const url = new URL(req.url);
  const restaurantId = url.searchParams.get('restaurant_id');

  // Validação: este parâmetro é obrigatório.
  // 400 Bad Request = erro do cliente (mandou requisição incompleta).
  if (!restaurantId) return json({ error: 'restaurant_id required' }, 400);

  try {
    const data = await queryHarper(
      `SELECT * FROM foodedge.menu_items WHERE restaurant_id = '${restaurantId}' AND available = true ORDER BY category`
    );
    return json(data, 200, { 'Cache-Control': 'public, max-age=120' });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// GET /api/personalization?user_id=xxx&region=xxx
// Retorna restaurantes ordenados por um score personalizado para o usuário.
// NÃO é cacheável: cada usuário tem um ranking diferente.
//
// ALGORITMO DE SCORE:
//   score = rating_base + pedidos_anteriores_neste_restaurante + (tags_em_comum × 0,5)
//
// Exemplo: restaurante com rating 4.5, usuário já pediu 2x, 3 tags em comum
//   score = 4.5 + 2 + (3 × 0.5) = 8.0
router.get('/api/personalization', async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');
  const region = url.searchParams.get('region') ?? 'sa-east-1';

  try {
    // Promise.all executa as duas queries ao Harper EM PARALELO.
    // Sem isso, seriam sequenciais: ~800ms + ~800ms = ~1600ms.
    // Com paralelo: max(~800ms, ~800ms) = ~800ms.
    // Se não há userId, retorna array vazio imediatamente (sem ir ao Harper).
    const [restaurants, users] = await Promise.all([
      queryHarper<any>(`SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`),
      userId ? queryHarper<any>(`SELECT * FROM foodedge.users WHERE id = '${userId}' LIMIT 1`) : Promise.resolve([]),
    ]);

    const user = users[0]; // LIMIT 1 → sempre no máximo 1 resultado
    const pop = edgeRegion(req); // região do PoP para o frontend exibir

    // Se não encontrou o usuário, retorna os restaurantes ordenados só por rating (sem personalização)
    if (!user) {
      return json(restaurants.sort((a: any, b: any) => b.rating - a.rating), 200, { 'Cache-Control': 'public, max-age=300', 'X-Edge-Region': pop });
    }

    // Calcula o score de cada restaurante com base no perfil do usuário
    const ranked = restaurants
      .map((r: any) => {
        let score = r.rating; // ponto de partida: nota do restaurante (ex: 4.5)

        // +1 para cada pedido anterior neste restaurante (fidelidade)
        // order_history é um array de IDs de restaurantes
        score += (user.order_history ?? []).filter((id: string) => id === r.id).length;

        // +0.5 para cada tag em comum entre restaurante e preferências do usuário
        // Exemplo: restaurante tem tags ["burger","grelhado"], usuário prefere ["burger","saudável"]
        // → 1 tag em comum → +0.5
        score += (r.tags ?? []).filter((t: string) => (user.preferences ?? []).includes(t)).length * 0.5;

        // Adiciona o score temporariamente no objeto para ordenar
        return { ...r, _score: score };
      })
      .sort((a: any, b: any) => b._score - a._score) // ordena do maior para menor score
      .map(({ _score, ...r }: any) => r); // remove _score antes de enviar (não expõe ao cliente)

    // private, no-store = CDN não cacheia + browser não cacheia
    // Essencial: se cacheasse, usuário A receberia o ranking do usuário B.
    return json(ranked, 200, { 'Cache-Control': 'private, no-store', 'X-Edge-Region': pop });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// GET /api/geo?lat=-23.5&lon=-46.6&radius=5
// Retorna restaurantes dentro de um raio (km) do usuário, com distância e ETA calculados.
// Todo o processamento é feito aqui no edge — sem geocoding externo, sem serviço de mapas.
router.get('/api/geo', async (req) => {
  const url = new URL(req.url);

  // parseFloat converte string para número decimal.
  // ?? '0' → se o parâmetro não vier, usa 0 (o que vai retornar restaurantes em lat=0/lon=0,
  // mas na prática o frontend sempre passa as coordenadas).
  const lat = parseFloat(url.searchParams.get('lat') ?? '0');
  const lon = parseFloat(url.searchParams.get('lon') ?? '0');
  const radius = parseFloat(url.searchParams.get('radius') ?? '5');

  try {
    // Busca TODOS os restaurantes ativos — o filtro de raio é feito no edge,
    // não no SQL. Harper não tem suporte nativo a queries geoespaciais.
    const restaurants = await queryHarper<any>('SELECT * FROM foodedge.restaurants WHERE active = true');

    const nearby = restaurants
      .map((r: any) => {
        // Calcula distância real em km usando Haversine
        const dist = haversineKm(lat, lon, r.location.lat, r.location.lon);

        // Math.round(x * 10) / 10 → arredonda para 1 casa decimal (ex: 3.14159 → 3.1)
        // ETA = tempo base do restaurante + 5 minutos por km além de 2km
        // Exemplo: dist=4km, delivery_time_min=25 → ETA = 25 + max(0, 4-2)*5 = 35 min
        return {
          ...r,
          distance_km: Math.round(dist * 10) / 10,
          estimated_delivery_min: Math.round(r.delivery_time_min + Math.max(0, dist - 2) * 5)
        };
      })
      .filter((r: any) => r.distance_km <= radius)   // remove os que estão fora do raio
      .sort((a: any, b: any) => a.distance_km - b.distance_km); // ordena do mais próximo

    return json(nearby, 200, { 'Cache-Control': 'public, max-age=120' });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// GET /api/orders/:id
// Consulta um pedido pelo ID. O :id é um parâmetro de rota capturado pelo itty-router.
router.get('/api/orders/:id', async (req) => {
  // itty-router coloca os parâmetros de rota em req.params, mas o TypeScript
  // não conhece essa propriedade (não está no tipo Request padrão),
  // então usamos "as any" para acessar sem erro de compilação.
  const id = (req as any).params.id;
  try {
    const rows = await queryHarper<any>(`SELECT * FROM foodedge.orders WHERE id = '${id}' LIMIT 1`);
    if (!rows.length) return new Response('Not found', { status: 404 });
    return json(rows[0]);
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// POST /api/orders
// Cria um novo pedido. Lê o corpo JSON, calcula o total, gera um ID único e salva no Harper.
// Não cacheável por natureza (é uma escrita, não uma leitura).
router.post('/api/orders', async (req) => {
  try {
    // req.json() lê e faz parse do corpo da requisição como JSON.
    // "as any" porque não temos um tipo definido para o payload de entrada.
    const body = await req.json() as any;

    // Calcula o total somando preço × quantidade de cada item do carrinho.
    // reduce() acumula um valor percorrendo o array: começa em 0, soma a cada iteração.
    const total = (body.items ?? []).reduce((s: number, i: any) => s + i.price * i.quantity, 0);

    const now = Date.now(); // timestamp em milissegundos desde 1970 (Unix timestamp)

    const order = {
      id: crypto.randomUUID(), // gera UUID v4 único (ex: "550e8400-e29b-41d4-a716-446655440000")
      ...body,                 // spread: copia todos os campos do body (user_id, restaurant_id, items...)
      status: 'confirmed',
      total,
      created_at: now,
      estimated_delivery_at: now + 30 * 60 * 1000, // agora + 30 minutos em ms
    };

    await insertHarper('orders', order);
    return json(order, 201); // 201 Created = recurso criado com sucesso
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// ============================================================
// PONTO DE ENTRADA DO WEBASSEMBLY
//
// Em ambientes browser/WASM, eventos são recebidos via addEventListener.
// "fetch" é o evento disparado quando chega uma requisição HTTP.
// event.respondWith() diz ao runtime qual Response deve ser enviada de volta.
// router.fetch() passa a requisição para o roteador, que encontra a rota correta
// e executa o handler correspondente.
// ============================================================
// @ts-ignore — FetchEvent não está nos tipos padrão do TypeScript, mas existe no WASM runtime
addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(router.fetch(event.request));
});
