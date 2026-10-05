// Função serverless do Vercel: as rotas /api/* e /tse/* (reescritas em vercel.json) passam
// pelo mesmo tratamento do servidor local. Os arquivos de public/ são servidos como estáticos.
import { tratar } from '../src/aplicacao.js';

export default tratar;
