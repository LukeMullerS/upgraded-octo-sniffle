#!/usr/bin/env node
// Servidor local do app de apuração: entrega os arquivos de `public/`, faz proxy de
// `/tse/*` para https://resultados.tse.jus.br/oficial/* e responde às rotas `/api/*`
// (ver src/aplicacao.js). Sem dependências: precisa só do Node.js 18+.

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { TSE_BASE, gravarTudo, salvos, tratar } from './src/aplicacao.js';

const PORTA = Number(process.env.PORT) || 3000;
// `--rede` (ou HOST=0.0.0.0) abre o app para outros aparelhos da rede, como o celular.
const REDE = process.argv.includes('--rede');
const HOST = process.env.HOST || (REDE ? '0.0.0.0' : '127.0.0.1');

const servidor = http.createServer(tratar);

// Endereços IPv4 desta máquina na rede local, para abrir o app no celular.
const enderecosLocais = () =>
  Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

// Ao sair, o banco e os logs são gravados.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, async () => {
    await gravarTudo();
    process.exit(0);
  });
}

servidor.listen(PORTA, HOST, () => {
  console.log(`Apuração 2026 em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
  if (HOST === '0.0.0.0') {
    for (const ip of enderecosLocais()) console.log(`No celular (mesma Wi-Fi): http://${ip}:${PORTA}`);
  }
  console.log(`Dados: ${TSE_BASE}${salvos ? ` (${salvos} resumos guardados carregados)` : ''}`);
});
