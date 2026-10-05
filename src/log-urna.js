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

/** Junta resumos de várias seções (de um município, de uma UF…). Médias ponderadas pelos eleitores. */
export function agregarResumos(lista) {
  const validos = lista.filter((r) => r && r.votos);
  const soma = (f) => validos.reduce((t, r) => t + (f(r) ?? 0), 0);
  const hist = new Array(MAX_HIST_S / FAIXA_HIST_S + 1).fill(0);
  const porHora = {};
  for (const r of validos) {
    r.hist?.forEach((c, i) => { hist[i] += c; });
    for (const [h, n] of Object.entries(r.porHora ?? {})) porHora[h] = (porHora[h] ?? 0) + n;
  }
  const nCab = soma((r) => r.cabine.n);
  const nAt = soma((r) => r.atendimento.n);
  const nHab = soma((r) => r.habilitacao.n);
  const votos = soma((r) => r.votos);
  const horarios = (campo) => validos.map((r) => r[campo]).filter((v) => v !== null && v !== undefined);
  const tipos = {
    biometrica: soma((r) => r.tipos.biometrica),
    manual: soma((r) => r.tipos.manual),
    semBiometria: soma((r) => r.tipos.semBiometria),
  };
  return {
    secoes: validos.length,
    votos,
    cabine: { n: nCab, media: nCab ? soma((r) => r.cabine.soma) / nCab : null, mediana: medianaHist(hist), p90: quantilHist(hist, 0.9) },
    atendimento: { n: nAt, media: nAt ? soma((r) => r.atendimento.soma) / nAt : null },
    habilitacao: { n: nHab, media: nHab ? soma((r) => r.habilitacao.soma) / nHab : null },
    tipos,
    pctBiometrica: votos ? (tipos.biometrica / votos) * 100 : null,
    pctManual: votos ? (tipos.manual / votos) * 100 : null,
    pctSemBiometria: votos ? (tipos.semBiometria / votos) * 100 : null,
    teclasPorEleitor: votos ? soma((r) => r.teclasIndevidas) / votos : null,
    correcoesPorMil: votos ? (soma((r) => r.correcoes) / votos) * 1000 : null,
    secoesComBateria: validos.filter((r) => r.bateria > 0).length,
    aberturaMedia: media(horarios('abertura')),
    encerramentoMedio: media(horarios('encerramento')),
    primeiroVotoMedio: media(horarios('primeiroVoto')),
    ultimoVotoMedio: media(horarios('ultimoVoto')),
    porHora,
    hist,
  };
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
