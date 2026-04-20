// ============================================================
// WEBPACK — BUNDLER E COMPILADOR DO SPIN APP
//
// Webpack transforma o código TypeScript em um único arquivo JavaScript
// (bundle.js) que depois é convertido para WebAssembly pelo j2w.
//
// Fluxo completo do build:
//   TypeScript (index.ts)
//     → ts-loader (compila TS para JS)
//     → webpack (empacota tudo em bundle.js)
//     → j2w (converte bundle.js para spin-app.wasm)
// ============================================================

import path from 'path';
import webpack from 'webpack';
import SpinSdkPlugin from "@spinframework/build-tools/plugins/webpack/index.js";
import { readFileSync, existsSync } from 'fs';

// Lê o arquivo .env da raiz do projeto e transforma em objeto chave-valor.
// Necessário porque as credenciais do Harper ficam no .env (fora do controle de versão)
// e precisam ser "injetadas" no bundle antes de compilar.
//
// Por que não usar process.env diretamente?
// Porque o WASM roda na Akamai (não em Node.js) — não há "variáveis de ambiente" em runtime.
// A solução é substituir as constantes pelo valor real em tempo de BUILD.
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '../.env'); // busca ../.env relativo ao spin-app/
  if (!existsSync(envPath)) return {};

  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')                              // divide por linha
      .filter(l => l && !l.startsWith('#') && l.includes('=')) // ignora linhas vazias e comentários
      .map(l => {
        const [k, ...v] = l.split('=');         // divide na primeira '=' (valor pode conter '=')
        return [k.trim(), v.join('=').trim()];  // reconstrói o valor com '=' de volta
      })
  );
}

// Webpack aceita configuração assíncrona (async) porque o SpinSdkPlugin.init() é async.
const config = async () => {
  const env = loadEnv();

  // Plugin oficial do Spin para webpack — configura internals necessários para
  // gerar código compatível com o runtime WebAssembly do Spin/j2w.
  let SpinPlugin = await SpinSdkPlugin.init();

  return {
    mode: 'production',       // otimizações de produção (tree shaking, etc)
    stats: 'errors-only',     // só mostra erros no terminal (reduz ruído)
    entry: './src/index.ts',  // arquivo de entrada — webpack começa aqui e segue os imports

    // Habilita output como ES Module (.mjs) — necessário para o j2w funcionar.
    // WebAssembly não entende CommonJS (require()), só ES Modules (import/export).
    experiments: { outputModule: true },

    module: {
      rules: [
        {
          test: /\.tsx?$/,    // aplica esta regra em arquivos .ts e .tsx
          use: 'ts-loader',   // ts-loader compila TypeScript para JavaScript
          exclude: /node_modules/, // não compila dependências (já são JS)
        },
      ],
    },

    resolve: {
      extensions: ['.tsx', '.ts', '.js'], // ordem de tentativa ao importar sem extensão
    },

    output: {
      path: path.resolve(process.cwd(), './build'), // saída em spin-app/build/bundle.js
      filename: 'bundle.js',
      module: true,                      // formato ES Module
      library: { type: "module" },       // exporta como módulo (necessário para j2w)
    },

    plugins: [
      SpinPlugin, // plugin do Spin (deve ser o primeiro)

      // DefinePlugin substitui texto no código-fonte durante o build.
      // Onde estiver "__HARPER_URL__" no código, webpack coloca o valor real.
      // JSON.stringify() garante que strings fiquem entre aspas no código gerado.
      //
      // Ordem de prioridade:
      //   1. process.env.HARPER_URL (variável de ambiente do sistema)
      //   2. env.HARPER_URL (lido do arquivo .env)
      //   3. '' (string vazia como fallback — causaria erro ao conectar no Harper)
      new webpack.DefinePlugin({
        '__HARPER_URL__':  JSON.stringify(process.env.HARPER_URL  ?? env.HARPER_URL  ?? ''),
        '__HARPER_USER__': JSON.stringify(process.env.HARPER_USER ?? env.HARPER_USER ?? ''),
        '__HARPER_PASS__': JSON.stringify(process.env.HARPER_PASS ?? env.HARPER_PASS ?? ''),
      }),
    ],

    optimization: { minimize: false }, // não minifica — facilita debug e o j2w funciona melhor
    performance: { hints: false },     // silencia avisos de tamanho de bundle
  };
};

export default config;
