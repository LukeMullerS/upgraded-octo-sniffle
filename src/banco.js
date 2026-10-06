// Banco único dos arquivos do TSE, compartilhado por todas as janelas do app.
//
// Antes, cada tela pedia ao TSE os arquivos de que precisava e esperava todos chegarem.
// Agora todo arquivo do TSE passa por aqui:
//   * cada arquivo é baixado uma vez e guardado (o conteúdo bruto para o proxy, ou só um
//     resumo processado, como os totais de brancos e nulos de um arquivo de resultado);
//   * a atualização usa GET condicional (ETag / Last-Modified): se o TSE responde 304, nada
//     é baixado de novo;
//   * uma fila única limita os pedidos simultâneos, dá prioridade ao que alguém está olhando
//     e recua quando o TSE pede calma (429/503);
//   * quem consulta recebe na hora o que já existe (`obter`) ou espera um pouco (`buscar`),
//     e os arquivos ainda pendentes chegam em segundo plano;
//   * só é atualizado automaticamente o que foi pedido nos últimos minutos;
//   * os resumos são gravados em disco e voltam na próxima vez que o servidor sobe.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function criarBanco({
  base,
  buscar = fetch,
  cabecalhos = {},
  concorrencia = 8,
  timeoutMs = 20_000,
  intervaloMs = 90_000, // idade a partir da qual um arquivo "em uso" é conferido de novo
  interesseMs = 10 * 60_000, // um arquivo pedido há mais tempo que isso deixa de ser atualizado
  arquivoDisco = null,
  agora = () => Date.now(),
  relogio = { setInterval, clearInterval, setTimeout },
} = {}) {
  const entradas = new Map(); // caminho → entrada
  // Três níveis: 2 = urgente (o que a tela está mostrando agora, ex.: proxy da Apuração),
  // 1 = normal (estados do cargo escolhido), 0 = fundo (outros cargos, municípios, conferências).
  const filas = [[], [], []];
  const naFila = () => filas[0].length + filas[1].length + filas[2].length;
  const nivelDe = (p) => (p === true ? 1 : Math.max(0, Math.min(2, Number(p) || 0)));
  let ativos = 0;
  let pausaAte = 0;
  const estat = { pedidos: 0, naoMudou: 0, baixados: 0, bytes: 0, erros: 0 };
  let alterado = false;

  function entrada(caminho) {
    let e = entradas.get(caminho);
    if (!e) {
      e = {
        caminho, estado: 'vazio', etag: null, modificado: null, conteudo: null, tipo: null, valor: null,
        consultadoEm: 0, mudouEm: 0, pedidoEm: 0, erro: null, promessa: null, processadores: new Map(),
        usos: new Set(), // 'json'/'bruto' = alguém precisa do conteúdo inteiro, não só do resumo
        registrados: new Map(), // nome → processar: resumos calculados assim que o arquivo chega
      };
      entradas.set(caminho, e);
    }
    return e;
  }

  // ---------- fila ----------

  function proximo() {
    if (ativos >= concorrencia || !naFila()) return;
    const espera = pausaAte - agora();
    if (espera > 0) {
      relogio.setTimeout(proximo, espera);
      return;
    }
    ativos += 1;
    const { tarefa, ok, falha } = (filas[2].length ? filas[2] : filas[1].length ? filas[1] : filas[0]).shift();
    tarefa().then(ok, falha).finally(() => { ativos -= 1; proximo(); });
  }

  // ---------- download condicional ----------

  async function baixar(e) {
    estat.pedidos += 1;
    const h = { ...cabecalhos };
    // Sem o conteúdo guardado (só o resumo), um 304 não serviria a quem precisa do arquivo inteiro.
    const condicional = e.estado === 'ok' && (e.conteudo || !precisaConteudo(e));
    if (condicional && e.etag) h['If-None-Match'] = e.etag;
    if (condicional && e.modificado) h['If-Modified-Since'] = e.modificado;
    let res;
    try {
      res = await buscar(`${base}/${e.caminho}`, { headers: h, signal: AbortSignal.timeout(timeoutMs) });
    } catch (erro) {
      estat.erros += 1;
      e.erro = erro?.name === 'TimeoutError' ? 'o TSE não respondeu a tempo' : erro.message;
      if (e.estado === 'vazio') e.estado = 'erro';
      e.consultadoEm = agora();
      return;
    }
    e.consultadoEm = agora();
    if (res.status !== 429 && res.status !== 503) e.conhecido = true;
    if (res.status === 304) {
      estat.naoMudou += 1;
      e.erro = null;
      return;
    }
    if (res.status === 429 || res.status === 503) {
      // O TSE pediu calma: toda a fila espera (Retry-After, ou 20 s).
      const segundos = Number(res.headers.get('retry-after')) || 20;
      pausaAte = agora() + segundos * 1000;
      estat.erros += 1;
      e.erro = `o TSE pediu para esperar (${res.status})`;
      if (e.estado === 'vazio') e.estado = 'erro';
      e.consultadoEm = 0; // tenta de novo assim que possível
      return;
    }
    if (res.status === 404 || res.status === 403) {
      // Ainda não publicado (o CDN do TSE responde 403 ou 404 para arquivo inexistente).
      if (e.estado !== 'indisponivel') alterado = true;
      e.estado = 'indisponivel';
      e.conteudo = null;
      e.valor = null;
      e.processadores.clear();
      e.erro = null;
      return;
    }
    if (!res.ok) {
      estat.erros += 1;
      e.erro = `o TSE respondeu HTTP ${res.status}`;
      if (e.estado === 'vazio') e.estado = 'erro';
      return;
    }
    const corpo = Buffer.from(await res.arrayBuffer());
    estat.baixados += 1;
    estat.bytes += corpo.length;
    e.etag = res.headers.get('etag');
    e.modificado = res.headers.get('last-modified');
    e.tipo = res.headers.get('content-type') || 'application/json';
    e.estado = 'ok';
    e.erro = null;
    e.mudouEm = agora();
    e.conteudo = corpo;
    e.valor = undefined; // JSON interpretado sob demanda
    e.processadores.clear();
    alterado = true;
    // Calcula já os resumos registrados: o arquivo pode ter chegado depois que a resposta a
    // quem pediu já saiu, e o resumo precisa existir para a próxima consulta e para o disco.
    for (const [nome, processar] of e.registrados) processado(e, nome, processar);
  }

  const precisaConteudo = (e) => e.usos.has('json') || e.usos.has('bruto');

  function consultar(e, prioridade) {
    const nivel = nivelDe(prioridade);
    if (!e.promessa) {
      e.item = null;
      e.promessa = new Promise((ok, falha) => {
        // Qualquer falha (corpo cortado no meio, resumo que lança erro) vira estado de erro:
        // ninguém espera algumas dessas consultas, e uma rejeição solta derrubaria o processo.
        e.item = { tarefa: () => baixar(e).catch((erro) => {
          estat.erros += 1;
          e.erro = erro?.name === 'TimeoutError' ? 'o TSE não respondeu a tempo' : (erro?.message ?? String(erro));
          if (e.estado === 'vazio') e.estado = 'erro';
          e.consultadoEm = agora();
        }), ok, falha, nivel };
        filas[nivel].push(e.item);
        proximo();
      }).finally(() => { e.promessa = null; e.item = null; });
    } else if (e.item && nivel > e.item.nivel) {
      // Já estava na fila com prioridade menor: sobe para a fila do novo nível.
      const atual = filas[e.item.nivel].indexOf(e.item);
      if (atual >= 0) {
        filas[e.item.nivel].splice(atual, 1);
        e.item.nivel = nivel;
        filas[nivel].push(e.item);
      }
    }
    return e.promessa;
  }

  const velho = (e) => e.estado === 'vazio' || e.estado === 'erro' || agora() - e.consultadoEm >= intervaloMs;

  // ---------- leitura ----------

  function json(e) {
    e.usos.add('json');
    if (e.estado !== 'ok') return null;
    if (!e.conteudo && e.valor === undefined) {
      // Só o resumo foi guardado: baixa o arquivo inteiro na próxima oportunidade.
      e.consultadoEm = 0;
      consultar(e, true);
      return null;
    }
    if (e.valor === undefined) {
      try {
        e.valor = JSON.parse(e.conteudo.toString('utf8'));
      } catch {
        e.valor = null;
        e.erro = 'o TSE devolveu um arquivo que não é JSON';
      }
    }
    return e.valor;
  }

  /** Resultado de `processar(json)` guardado junto do arquivo (refeito só quando o arquivo muda). */
  function processado(e, nome, processar) {
    if (!processar) return json(e);
    if (e.processadores.has(nome)) return e.processadores.get(nome);
    const usava = e.usos.has('json');
    const bruto = json(e);
    if (!usava) e.usos.delete('json');
    // Arquivo guardado só como outro resumo: o inteiro está sendo baixado (json() agendou).
    // Não guarda "null" como resultado, senão um 304 depois o deixaria preso.
    if (bruto === null && e.estado === 'ok') return null;
    let v;
    try {
      v = bruto === null ? null : processar(bruto);
    } catch (erro) {
      e.erro = `arquivo com formato inesperado: ${erro.message}`;
      return null;
    }
    e.processadores.set(nome, v);
    // Ninguém pediu o arquivo inteiro: guarda só o resumo (os de deputados são grandes).
    if (!precisaConteudo(e)) {
      e.conteudo = null;
      e.valor = undefined;
    }
    return v;
  }

  function resposta(e, nome, processar) {
    const valor = e.estado === 'ok' ? processado(e, nome, processar) : (e.salvo?.[nome] ?? null);
    return {
      estado: e.estado, // vazio | ok | indisponivel | erro
      valor,
      // Pendente = ainda não se sabe nada do arquivo. Uma reconferência de algo já conhecido
      // (inclusive o que veio do disco) não conta.
      pendente: !e.conhecido && valor === null && (e.estado === 'vazio' || Boolean(e.promessa)),
      erro: e.erro,
      atualizadoEm: e.mudouEm || null,
    };
  }

  /**
   * Devolve na hora o que o banco tem (e agenda a consulta se o arquivo está velho).
   * @param {string} caminho  caminho no TSE, relativo a `base`
   * @param {{processar?: Function, nome?: string, prioridade?: boolean, auto?: boolean}} opcoes
   *   processar: transforma o JSON (ex.: resumo de votos); nome: chave desse resultado
   *   auto: false = não atualizar sozinho (quem chama decide quando, com `atualizar`)
   */
  function obter(caminho, { processar = null, nome = 'json', prioridade = false, auto = true } = {}) {
    const e = entrada(caminho);
    e.pedidoEm = agora();
    e.auto = auto;
    if (processar) e.registrados.set(nome, processar);
    if (e.estado === 'vazio' || e.estado === 'erro' || (auto && velho(e))) consultar(e, prioridade);
    return resposta(e, nome, processar);
  }

  /**
   * Como `obter`, mas espera a consulta em andamento (até `esperarMs`) quando ainda não há
   * nenhum valor. Havendo valor (inclusive o guardado em disco), responde já e a conferência
   * com o TSE continua em segundo plano.
   */
  async function buscar_(caminho, opcoes = {}) {
    const r = obter(caminho, opcoes);
    const e = entradas.get(caminho);
    if (e.promessa && r.valor === null && !e.conhecido) {
      await Promise.race([e.promessa, new Promise((ok) => relogio.setTimeout(ok, opcoes.esperarMs ?? timeoutMs))]);
      return resposta(e, opcoes.nome ?? 'json', opcoes.processar ?? null);
    }
    return r;
  }

  /** Força uma nova consulta (condicional) e espera o resultado. */
  async function atualizar(caminho, opcoes = {}) {
    const e = entrada(caminho);
    e.pedidoEm = agora();
    await consultar(e, opcoes.prioridade);
    return resposta(e, opcoes.nome ?? 'json', opcoes.processar ?? null);
  }

  /** Conteúdo bruto (para o proxy /tse/*): {status, tipo, corpo}. */
  async function bruto(caminho) {
    const e = entrada(caminho);
    e.usos.add('bruto');
    e.pedidoEm = agora();
    // Sem o conteúdo inteiro guardado (só havia o resumo), ou velho: baixa e espera.
    if (e.estado !== 'ok' || !e.conteudo || velho(e)) {
      if (e.estado === 'ok' && !e.conteudo) e.consultadoEm = 0;
      await Promise.race([consultar(e, 2), new Promise((ok) => relogio.setTimeout(ok, timeoutMs))]);
    }
    const r = resposta(e, 'json', null);
    if (r.estado === 'ok' && e.conteudo) return { status: 200, tipo: e.tipo, corpo: e.conteudo };
    if (r.estado === 'indisponivel') return { status: 404, tipo: 'text/plain', corpo: Buffer.from('não publicado') };
    return { status: 502, tipo: 'application/json; charset=utf-8', corpo: Buffer.from(JSON.stringify({ erro: r.erro ?? 'falha ao consultar o TSE' })) };
  }

  // ---------- atualização em segundo plano ----------

  const timer = relogio.setInterval(() => {
    const t = agora();
    for (const e of entradas.values()) {
      if (e.auto !== false && t - e.pedidoEm < interesseMs && velho(e) && !e.promessa) consultar(e, false);
    }
  }, 15_000);
  timer?.unref?.();

  // ---------- disco (só os resumos processados, que são pequenos) ----------

  async function salvarDisco() {
    if (!arquivoDisco || !alterado) return;
    alterado = false;
    const dados = {};
    for (const e of entradas.values()) {
      if (e.estado === 'ok' && e.processadores.size) {
        const proc = Object.fromEntries([...e.processadores].filter(([, v]) => v !== null && v !== undefined));
        if (Object.keys(proc).length) dados[e.caminho] = { etag: e.etag, modificado: e.modificado, mudouEm: e.mudouEm, proc };
      } else if (e.estado === 'indisponivel') {
        dados[e.caminho] = { indisponivel: true };
      } else if (e.salvo) {
        // Veio do disco e ainda não foi reconferido com o TSE: continua guardado.
        dados[e.caminho] = { mudouEm: e.mudouEm, proc: e.salvo };
      }
    }
    try {
      await mkdir(dirname(arquivoDisco), { recursive: true });
      await writeFile(`${arquivoDisco}.tmp`, JSON.stringify(dados));
      await rename(`${arquivoDisco}.tmp`, arquivoDisco);
    } catch {
      alterado = true;
    }
  }

  async function carregarDisco() {
    if (!arquivoDisco) return 0;
    try {
      const dados = JSON.parse(await readFile(arquivoDisco, 'utf8'));
      let n = 0;
      for (const [caminho, d] of Object.entries(dados)) {
        const e = entrada(caminho);
        if (e.estado !== 'vazio') continue;
        // Valor salvo serve de resposta imediata até a primeira consulta ao TSE terminar.
        e.conhecido = true;
        if (d.indisponivel) {
          e.estado = 'indisponivel';
        } else {
          e.salvo = d.proc;
          e.mudouEm = d.mudouEm;
        }
        n += 1;
      }
      return n;
    } catch {
      return 0;
    }
  }

  const timerDisco = arquivoDisco ? relogio.setInterval(salvarDisco, 60_000) : null;
  timerDisco?.unref?.();

  function status() {
    let pendentes = 0;
    let ok = 0;
    let indisponiveis = 0;
    let erros = 0;
    for (const e of entradas.values()) {
      if (e.promessa) pendentes += 1;
      if (e.estado === 'ok') ok += 1;
      else if (e.estado === 'indisponivel') indisponiveis += 1;
      else if (e.estado === 'erro') erros += 1;
    }
    return {
      arquivos: entradas.size, ok, indisponiveis, erros, pendentes, naFila: naFila(), emAndamento: ativos,
      pausadoAte: pausaAte > agora() ? new Date(pausaAte).toISOString() : null, ...estat,
    };
  }

  function encerrar() {
    relogio.clearInterval(timer);
    if (timerDisco) relogio.clearInterval(timerDisco);
  }

  return { obter, buscar: buscar_, atualizar, bruto, status, salvarDisco, carregarDisco, encerrar, entradas };
}
