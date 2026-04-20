// ============================================================
// VITE CONFIG — frontend/vite.config.ts
//
// Vite é o bundler/servidor do frontend. Esta configuração
// define como o frontend é servido no desenvolvimento e como
// é empacotado para produção (npm run build).
// ============================================================

import { defineConfig } from "vite";

export default defineConfig({
  root: ".",       // diretório raiz do projeto (onde está o index.html)
  publicDir: "public", // arquivos copiados diretamente para o build sem processamento

  server: {
    port: 5173, // porta do servidor de desenvolvimento (acesso em http://localhost:5173)

    // PROXY — redireciona chamadas de /api/* para a Akamai Functions em produção.
    // No desenvolvimento, o browser está em localhost:5173 e a API está em fwf.app.
    // Sem proxy, o browser bloquearia a requisição por CORS.
    // Com proxy, o Vite intercepta as chamadas /api/* e as repassa para a URL configurada,
    // fazendo parecer que tudo está no mesmo domínio para o browser.
    proxy: {
      "/api": "https://ccb238be-09c1-4260-8e13-8acb59f504a7.fwf.app",
    },
  },
});
