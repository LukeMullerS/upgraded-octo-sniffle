// Leitura do log da urna (logd.dat) e resumo por seção.
//
// Cada linha do logd.dat tem campos separados por tabulação, em latin-1:
//   data hora | nível (INFO/ALERTA/ERRO) | id da urna | aplicação | mensagem | hash
// O log NÃO registra em quem o eleitor votou, nem se votou em branco ou nulo: só a sequência
// de eventos. Para cada eleitor, os eventos da aplicação VOTA são, em ordem:
//   "Título digitado pelo mesário" → [biometria…] → "Eleitor foi habilitado"
//   → "Voto confirmado para [cargo]"… → "O voto do eleitor foi computado"
// Daí saem o tempo na cabine (habilitado → computado) e o tempo de atendimento
// (título digitado → computado). Os horários são os do relógio de cada urna.

export const FAIXA_HIST_S = 15; // largura das faixas do histograma de tempo na cabine
export const MAX_HIST_S = 600; // além de 10 min vai para a última faixa
const MAX_VALIDO_S = 30 * 60; // durações acima de 30 min (urna suspensa etc.) ficam fora das médias

const segundosDoDia = (hora) => {
  const [h, m, s] = hora.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const mediana = (v) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const meio = o.length >> 1;
  return o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2;
};

const quantil = (v, q) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(q * o.length))];
};

const media = (v) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : null);

/** Texto do logd.dat (bytes em latin-1 ou string) → resumo da votação da seção. */
export function resumirLog(entrada) {
  const texto = typeof entrada === 'string' ? entrada : new TextDecoder('latin1').decode(entrada);
  const linhas = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const c = bruta.split('\t');
    if (c.length < 5 || !/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(c[0])) continue;
    linhas.push({ data: c[0].slice(0, 10), t: segundosDoDia(c[0].slice(11)), nivel: c[1], urna: c[2], app: c[3], msg: c[4] });
  }

  // O log inclui dias de preparação da urna: o dia da votação é o com mais votos computados.
  const votosPorDia = new Map();
  for (const l of linhas) if (l.msg === 'O voto do eleitor foi computado') votosPorDia.set(l.data, (votosPorDia.get(l.data) ?? 0) + 1);
  const dia = [...votosPorDia].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const doDia = dia ? linhas.filter((l) => l.data === dia) : [];

  const cabine = [];
  const atendimento = [];
  const habilitacao = [];
  const tipos = { biometrica: 0, manual: 0, semBiometria: 0 };
  const porHora = {};
  const hist = new Array(MAX_HIST_S / FAIXA_HIST_S + 1).fill(0);
  let foraDaFaixa = 0;
  let teclas = 0;
  let correcoes = 0;
  let inatividade = 0;
  let canceladas = 0;
  let bateria = 0;
  let ligacoes = 0;
  let abertura = null;
  let encerramento = null;
  let primeiro = null;
  let ultimo = null;
  let modelo = null;
  let eleitor = null;

  for (const l of linhas) {
    const m = /Identificação do Modelo de Urna: (\S+)/.exec(l.msg);
    if (m) modelo = m[1];
  }

  for (const l of doDia) {
    const { msg, t } = l;
    if (msg.startsWith('Urna ligada em')) ligacoes += 1;
    if (msg === 'Urna operando na bateria interna') bateria += 1;
    if (l.app !== 'VOTA') continue;
    if (msg === 'Urna pronta para receber votos' && abertura === null) abertura = t;
    else if (msg === 'Inicio do Encerramento') encerramento = t;
    else if (msg === 'Título digitado pelo mesário') eleitor = { titulo: t, tipo: null };
    else if (msg.startsWith('Tipo de habilitação do eleitor [biom')) { if (eleitor) eleitor.tipo = 'biometrica'; }
    else if (msg === 'O eleitor não possui biometria') { if (eleitor && !eleitor.tipo) eleitor.tipo = 'semBiometria'; }
    else if (msg.startsWith('Solicitação de dado pessoal do eleitor para habilitação manual')) { if (eleitor && eleitor.tipo !== 'semBiometria') eleitor.tipo = 'manual'; }
    else if (msg === 'Eleitor foi habilitado') {
      if (!eleitor) eleitor = { titulo: null, tipo: null };
      eleitor.habilitado = t;
    } else if (msg === 'Tecla indevida pressionada') teclas += 1;
    else if (msg.startsWith('Eleitor corrigiu')) correcoes += 1;
    else if (msg.startsWith('Eleitor sem atividade')) inatividade += 1;
    else if (msg.startsWith('Habilitação cancelada')) { canceladas += 1; eleitor = null; }
    else if (msg === 'O voto do eleitor foi computado') {
      const hora = Math.floor(t / 3600);
      porHora[hora] = (porHora[hora] ?? 0) + 1;
      if (primeiro === null) primeiro = t;
      ultimo = t;
      if (eleitor?.habilitado !== undefined) {
        const dCab = t - eleitor.habilitado;
        if (dCab >= 0 && dCab <= MAX_VALIDO_S) {
          cabine.push(dCab);
          hist[Math.min(hist.length - 1, Math.floor(dCab / FAIXA_HIST_S))] += 1;
        } else {
          foraDaFaixa += 1;
        }
        if (eleitor.titulo !== null) {
          const dAt = t - eleitor.titulo;
          if (dAt >= 0 && dAt <= MAX_VALIDO_S) {
            atendimento.push(dAt);
            habilitacao.push(eleitor.habilitado - eleitor.titulo);
          }
        }
      }
      tipos[eleitor?.tipo ?? 'manual'] += 1;
      eleitor = null;
    }
  }

  const votos = Object.values(porHora).reduce((a, b) => a + b, 0);
  return {
    dia,
    urna: doDia[0]?.urna ?? linhas[0]?.urna ?? null,
    modelo,
    votos,
    cabine: { n: cabine.length, media: media(cabine), mediana: mediana(cabine), p90: quantil(cabine, 0.9), soma: cabine.reduce((a, b) => a + b, 0) },
    atendimento: { n: atendimento.length, media: media(atendimento), mediana: mediana(atendimento), soma: atendimento.reduce((a, b) => a + b, 0) },
    habilitacao: { n: habilitacao.length, media: media(habilitacao), soma: habilitacao.reduce((a, b) => a + b, 0) },
    tipos,
    teclasIndevidas: teclas,
    correcoes,
    inatividade,
    canceladas,
    foraDaFaixa,
    bateria,
    ligacoes,
    abertura,
    encerramento,
    primeiroVoto: primeiro,
    ultimoVoto: ultimo,
    porHora,
    hist,
  };
}

// ---------- acumuladores: somam seções sem guardá-las ----------
// Um acumulador guarda só somas e contagens; acumuladores se juntam (município → UF → Brasil)
// e `finalizar` produz as médias. Assim a compilação nacional cabe na memória.

export function novoAcumulador() {
  return {
    secoes: 0, votos: 0, cabN: 0, cabSoma: 0, atN: 0, atSoma: 0, habN: 0, habSoma: 0,
    tipos: { biometrica: 0, manual: 0, semBiometria: 0 }, teclas: 0, correcoes: 0, comBateria: 0,
    abertura: [0, 0], encerramento: [0, 0], primeiro: [0, 0], ultimo: [0, 0],
    porHora: {}, hist: new Array(MAX_HIST_S / FAIXA_HIST_S + 1).fill(0),
  };
}

const somarHorario = (par, v) => { if (v !== null && v !== undefined) { par[0] += v; par[1] += 1; } };

/** Soma o resumo de uma seção (saída de resumirLog) ao acumulador. */
export function acumular(acc, r) {
  if (!r || !r.votos) return acc;
  acc.secoes += 1;
  acc.votos += r.votos;
  acc.cabN += r.cabine.n; acc.cabSoma += r.cabine.soma ?? 0;
  acc.atN += r.atendimento.n; acc.atSoma += r.atendimento.soma ?? 0;
  acc.habN += r.habilitacao.n; acc.habSoma += r.habilitacao.soma ?? 0;
  for (const k of Object.keys(acc.tipos)) acc.tipos[k] += r.tipos?.[k] ?? 0;
  acc.teclas += r.teclasIndevidas ?? 0;
  acc.correcoes += r.correcoes ?? 0;
  if (r.bateria > 0) acc.comBateria += 1;
  somarHorario(acc.abertura, r.abertura);
  somarHorario(acc.encerramento, r.encerramento);
  somarHorario(acc.primeiro, r.primeiroVoto);
  somarHorario(acc.ultimo, r.ultimoVoto);
  for (const [h, n] of Object.entries(r.porHora ?? {})) acc.porHora[h] = (acc.porHora[h] ?? 0) + n;
  r.hist?.forEach((c, i) => { acc.hist[i] += c; });
  return acc;
}

/** Junta dois acumuladores (o primeiro é alterado). */
export function juntar(acc, b) {
  if (!b) return acc;
  for (const k of ['secoes', 'votos', 'cabN', 'cabSoma', 'atN', 'atSoma', 'habN', 'habSoma', 'teclas', 'correcoes', 'comBateria']) acc[k] += b[k];
  for (const k of Object.keys(acc.tipos)) acc.tipos[k] += b.tipos[k];
  for (const k of ['abertura', 'encerramento', 'primeiro', 'ultimo']) { acc[k][0] += b[k][0]; acc[k][1] += b[k][1]; }
  for (const [h, n] of Object.entries(b.porHora)) acc.porHora[h] = (acc.porHora[h] ?? 0) + n;
  b.hist.forEach((c, i) => { acc.hist[i] += c; });
  return acc;
}

const mediaPar = (par) => (par[1] ? par[0] / par[1] : null);

/** Médias, medianas e percentuais a partir do acumulador. */
export function finalizar(acc) {
  const { votos, tipos } = acc;
  return {
    secoes: acc.secoes,
    votos,
    cabine: { n: acc.cabN, media: acc.cabN ? acc.cabSoma / acc.cabN : null, mediana: medianaHist(acc.hist), p90: quantilHist(acc.hist, 0.9) },
    atendimento: { n: acc.atN, media: acc.atN ? acc.atSoma / acc.atN : null },
    habilitacao: { n: acc.habN, media: acc.habN ? acc.habSoma / acc.habN : null },
    tipos: { ...tipos },
    pctBiometrica: votos ? (tipos.biometrica / votos) * 100 : null,
    pctManual: votos ? (tipos.manual / votos) * 100 : null,
    pctSemBiometria: votos ? (tipos.semBiometria / votos) * 100 : null,
    teclasPorEleitor: votos ? acc.teclas / votos : null,
    correcoesPorMil: votos ? (acc.correcoes / votos) * 1000 : null,
    secoesComBateria: acc.comBateria,
    aberturaMedia: mediaPar(acc.abertura),
    encerramentoMedio: mediaPar(acc.encerramento),
    primeiroVotoMedio: mediaPar(acc.primeiro),
    ultimoVotoMedio: mediaPar(acc.ultimo),
    porHora: { ...acc.porHora },
    hist: [...acc.hist],
  };
}

/** Junta resumos de várias seções (de um município, de uma UF…). Médias ponderadas pelos eleitores. */
export function agregarResumos(lista) {
  const acc = novoAcumulador();
  for (const r of lista) acumular(acc, r);
  return finalizar(acc);
}

function quantilHist(hist, q) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const alvo = q * total;
  let acum = 0;
  for (let i = 0; i < hist.length; i += 1) {
    if (acum + hist[i] >= alvo) {
      const fracao = hist[i] ? (alvo - acum) / hist[i] : 0;
      return (i + fracao) * FAIXA_HIST_S;
    }
    acum += hist[i];
  }
  return MAX_HIST_S;
}

const medianaHist = (hist) => quantilHist(hist, 0.5);
