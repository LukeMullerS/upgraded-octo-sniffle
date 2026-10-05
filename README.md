# Apuração Eleições 2026

App simples para acompanhar a apuração do **1º turno das Eleições 2026 (04/10/2026, pleito 3220)**
com os arquivos públicos de resultado do TSE — <https://resultados.tse.jus.br>, ambiente **oficial**.

| Código | Eleição | Cargos |
| --- | --- | --- |
| 6257 | Eleição Geral Federal | Presidente (Brasil, cada UF e Exterior) |
| 6259 | Eleições Gerais Estaduais 2026 | Governador, Senador, Deputado Federal, Deputado Estadual, Deputado Distrital (DF) |
| 6261 | Eleição Conselho Distrital 2026 | Conselheiro Distrital (Fernando de Noronha/PE) |

## Como rodar

Precisa só do **Node.js 18+** — não há dependências para instalar.

```bash
npm start          # ou: node server.js
```

Abra <http://127.0.0.1:3000>.

### No celular

A página é responsiva e pode ser instalada na tela inicial ("Adicionar à tela de início").
Para abrir no celular conectado à **mesma Wi‑Fi** do computador:

```bash
npm run celular    # ou: node server.js --rede
```

O terminal mostra o endereço para digitar no celular, por exemplo `http://192.168.0.10:3000`.
Se não abrir, libere a porta 3000 no firewall do computador.

### Rodando no próprio celular (Android)

Dá para rodar o app inteiro no Android, sem computador, com o [Termux](https://termux.dev)
(instale pelo F-Droid ou pelo GitHub do Termux; a versão da Play Store está desatualizada). No Termux:

```bash
pkg update && pkg install -y nodejs git
git clone -b claude/eleicoes-2026-apuracao-app-6hxol0 https://github.com/LukeMullerS/upgraded-octo-sniffle
cd upgraded-octo-sniffle
npm start
```

Depois abra <http://127.0.0.1:3000> no Chrome do celular. Deixe o Termux aberto em segundo plano enquanto
usa o app. Para rodar de novo outro dia: `cd upgraded-octo-sniffle && git pull && npm start`.

No iPhone não há um jeito prático de rodar Node.js; use o computador com `npm run celular`.

Variáveis opcionais: `PORT` (padrão 3000), `HOST` (padrão `127.0.0.1`; use `0.0.0.0` para abrir na rede)
e `TSE_BASE` (padrão `https://resultados.tse.jus.br/oficial`). Também: `IBGE_BASE` (API de agregados do IBGE),
`IBGE_MALHAS` (API de malhas do IBGE, para os mapas), `LOGS_NACIONAL` e `LOGS_CONCORRENCIA` (ver Logs das urnas).

## O que o app mostra

- Filtros de **eleição**, **cargo**, **abrangência** (Brasil, UF, Exterior) e **município**.
- Percentual de **seções totalizadas** e horário da última atualização do TSE.
- **Candidatos** ordenados por votos, com foto, partido, vice e situação (Eleito, 2º turno…).
  Nos cargos proporcionais a lista é compacta, com busca e paginação, e há um quadro de votos nominais por partido.
- **Dados gerais**: eleitorado, comparecimento, abstenção, válidos, brancos e nulos.
- **Atualização automática** a cada 60 s (pausa com a aba em segundo plano) e botão de atualizar.
- A seleção fica na URL (`#ele=6259&cargo=0&abr=sp`), então dá para compartilhar o link.

## Banco único de dados

Todas as janelas (Apuração, Brancos e nulos, Explorador, Logs) leem do mesmo banco no servidor (`src/banco.js`):

- cada arquivo do TSE é baixado **uma vez** e compartilhado; a cada 1–2 minutos o banco confere se mudou com
  GET condicional (ETag) — se o TSE responde "não mudou" (304), nada é baixado de novo;
- uma fila única limita os pedidos simultâneos, com três níveis de prioridade (o que está na tela primeiro;
  painéis secundários, municípios e conferências depois) e espera quando o TSE pede calma (429/503);
- as consultas respondem **na hora** com o que já existe e dizem quantos arquivos ainda estão chegando; as janelas
  vão se completando sozinhas;
- dos arquivos grandes (deputados) só o resumo de brancos e nulos fica na memória;
- os resumos são gravados em `dados/banco.json` e voltam instantaneamente quando o servidor reinicia;
- na barra de tarefas, o ícone de banco ao lado do relógio pisca enquanto há arquivos chegando; clicar nele mostra
  o estado do banco (arquivos guardados, na fila, consultas, 304, MB baixados). Também em `/api/banco`.

## Área de trabalho Windows 98

Por padrão o app abre como uma área de trabalho do Windows 98 (`/desktop.html`): cada tela é uma janela que se
arrasta pela barra de título, redimensiona pelas bordas, minimiza, maximiza (também com duplo clique) e fecha.

- **Ícones** (duplo clique; no celular, um toque): Apuração, Brancos e nulos, Painéis, Explorador, Leia-me, TSE, IBGE.
- **Menu Iniciar** → Programas → Eleições 2026 → **Painéis**: cada painel de brancos e nulos (resumo, estatísticas,
  distribuição, dispersão, maiores e menores, por cargo, comparação, tabela) abre numa **janela própria**. Os filtros
  ficam sincronizados entre as janelas do painel.
- **Botão direito** na área de trabalho: cascata, lado a lado, minimizar todas, atualizar, papel de parede.
- As janelas abertas, posições e tamanhos ficam guardados no navegador.
- Iniciar → Configurações → **Visual moderno** (ou Desligar… → Voltar ao visual moderno) troca para a interface
  comum; nela, o botão "Visual Windows 98" volta.

## Explorador de variáveis (estilo JASP/jamovi)

A janela **Explorador** cruza, por estado ou por cidade, variáveis da eleição (de vários cargos), do território
(UF, região, porte, capital), dos **logs das urnas** e do **Censo/IBGE**. Três jeitos de usar, do mais simples ao
mais livre:

1. **"O que você quer descobrir?"** — perguntas prontas com um clique (onde mais se votou nulo, brancos e nulos por
   região, alfabetização × nulos, tempo na cabine × nulos, capitais × interior, presidente × senador, o que mais
   explica os nulos, ranking das cidades, porte).
2. **"Monte sua análise"** — uma frase com listas: *olhando para* (estados / cidades) *quero entender* (Y)
   *comparando com* (X) *separando por* (grupo) *usando* (tipo de análise). A escolha automática decide sozinha.
3. **Arrastar e soltar** (em "Modo avançado"): eixos X/Y, grupo/cor, tamanho e matriz de correlação.

Tipos de análise e o que mostram:

- **Mapa** interativo (coroplético, IBGE): estados ou cidades coloridos pelo valor; zoom com a roda/pinça.
- **Correlação**: dispersão com regressão linear, r de Pearson, ρ de Spearman, R², valor-p e r por grupo.
- **Comparar grupos**: boxplot e ANOVA de um fator (F, p, η²).
- **Teste t de Welch** (2 grupos): diferença das médias, p e d de Cohen.
- **Regressão múltipla** (MQO): coeficientes, erros padrão, t, p, pesos padronizados (beta), R² e R² ajustado.
- **Ranking**: os maiores e os menores. **Distribuição**: histograma e descritivas.

Cada resultado vem com um **"Em resumo"** em português simples e as abas **Gráfico · Mapa · Dados**; os detalhes
estatísticos, as descritivas e a matriz de correlação ficam logo abaixo. Tudo é calculado no navegador
(`public/calculos.js`), sem bibliotecas externas.

**Censo/IBGE**: o servidor baixa as séries da API de agregados do IBGE (SIDRA) e as guarda em `dados/censo`
(o Censo não muda, então só a primeira consulta depende do IBGE). Já vêm prontas população, densidade, área e
taxa de alfabetização (Censo 2022); qualquer outra tabela do SIDRA entra pelo número (por exemplo, a de nível de
instrução), escolhendo a variável e as categorias. Também dá para **importar um CSV** (primeira coluna: código IBGE,
código TSE, sigla da UF ou nome do local). A ligação com as cidades usa o código IBGE que o TSE publica.

## Logs das urnas (tempo de votação)

A janela **Logs das urnas** mede o tempo de votação a partir do log de cada urna:

- Para cada seção, o servidor vê se o TSE já publicou os arquivos da urna (`aux.json` da seção), baixa o log
  (`logd.dat`, dentro do `.jez`, que é um 7z) e lê os eventos de cada eleitor.
- **Tempo na cabine**: de "Eleitor foi habilitado" até "O voto do eleitor foi computado". **Atendimento**: do
  "Título digitado pelo mesário" até o voto computado (inclui a biometria). Também: habilitação biométrica, manual ou
  sem biometria, teclas indevidas, votos por hora, horário de abertura e encerramento, urnas que usaram bateria.
- Os números cobrem só as seções já lidas; horários são os do relógio de cada urna; durações acima de 30 min ficam
  fora das médias. O log não registra em quem nem como o eleitor votou: brancos e nulos vêm do resultado oficial e
  são cruzados com o tempo médio por município ou por estado (dispersão com regressão).
- **Compilação nacional automática**: assim que o servidor liga, ele passa por todas as UFs (as pequenas e as do
  Norte primeiro) e lê o log de toda seção já totalizada, de novo a cada 2 minutos — não é preciso escolher cidade
  nem seção. Só procura onde o acompanhamento do TSE já mostra seções totalizadas e pula municípios completos.
  Cada log é lido uma única vez; os resumos ficam em `dados/logs` e sobrevivem a reinícios.
- A janela mostra o progresso (barra nacional e por estado, botão Pausar/Retomar), os indicadores do Brasil, de um
  estado ou de um município, e um **mapa interativo** (estados → clique → municípios → clique → seções) pintado pelo
  indicador escolhido: tempo na cabine, atendimento, habilitação, % biometria, teclas indevidas, horário de
  abertura/encerramento ou % brancos e nulos do resultado.
- Variáveis: `LOGS_NACIONAL=0` desliga a compilação automática; `LOGS_CONCORRENCIA` (padrão 6) define quantos logs
  são baixados ao mesmo tempo.
- O 7z é aberto por um leitor próprio em JavaScript (`src/sete-zip.js`, LZMA/LZMA2), sem precisar do 7-Zip.
- No Explorador, as variáveis do grupo "Logs das urnas" (tempo médio na cabine, mediana, atendimento, % biometria…)
  aparecem para os locais com logs lidos.

## Brancos e nulos por estado e cidade

A aba **Brancos e nulos** (`/brancos.html`) mostra, para cada cargo, os votos brancos, nulos e anulados:

- **Por estado**: tabela com as UFs (e o exterior, para presidente), com percentuais sobre o total de votos e uma
  barra empilhada brancos | nulos | anulados na mesma escala. Toque num estado para ver as cidades.
- **Por cidade**: todas as cidades da UF, com busca e ordenação (% brancos + nulos, % brancos, % nulos, % anulados,
  total de votos, seções totalizadas ou nome).

Como é feito: o TSE publica um arquivo de resultado por município, sem um arquivo único por UF. O servidor
(`src/coletor.js`) lê a lista de municípios e, a cada **2 minutos**, o arquivo de acompanhamento da UF
(`{uf}-e{eleição}-ab.json`), que diz quantas seções cada município já totalizou; então baixa só os municípios que
mudaram. Os números cobrem apenas as seções já totalizadas e as cidades aparecem à medida que são lidas. Uma UF só
é acompanhada enquanto alguém a consulta (pára após 15 minutos sem acesso).

- **Brancos** = `v.vb`; **nulos** = `v.tvn` (nulos + nulos técnicos, como no app oficial);
  **anulados** = `v.van + v.vansj` (votos em candidatos com registro anulado ou sub judice).
- O log da urna (`logd.dat`) não registra como o eleitor votou, só que o voto foi computado; por isso brancos e
  nulos vêm do resultado oficial e não dos logs.

## Arquivos do TSE usados

O TSE publica JSON estáticos num CDN (números como string em pt-BR, ex. `"1.234"` e `"45,67"`):

```
/oficial/ele2026/{eleição}/dados/{abr}/{abr}-c{cargo:4}-e{eleição:6}-u.json            resultado BR / UF / exterior (zz)
/oficial/ele2026/{eleição}/dados/{uf}/{uf}{município}-c{cargo:4}-e{eleição:6}-u.json   resultado de um município
/oficial/ele2026/{eleição}/config/mun-e{eleição:6}-cm.json                             municípios de cada UF
/oficial/ele2026/{eleição}/fotos/{abr}/{sqcand}.jpeg                                   foto do candidato
```

Códigos de cargo: 1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual, 8 Dep. Distrital.
O código do cargo de **Conselheiro Distrital** não é documentado pelo TSE; o app o descobre testando os
códigos prováveis (lista em `CARGOS_CANDIDATOS_CONSELHO`, `public/tse.js`) até achar o arquivo publicado,
primeiro no nível da UF e depois no município de Fernando de Noronha.

O `server.js` faz proxy de `/tse/*` para o TSE porque o CDN recusa clientes sem User-Agent de navegador e
não garante CORS; ele também guarda as respostas por 30 s para não multiplicar consultas. Para abrir a
página consultando o TSE direto do navegador (sem proxy), use `?direto=1`.

Antes de o TSE publicar um arquivo (ex.: antes da apuração), o app mostra "Arquivo ainda não publicado".

## Estrutura

```
server.js          servidor estático + proxy para o TSE + APIs (/api/estados, /api/municipios, /api/banco, …)
src/banco.js       banco único dos arquivos do TSE (GET condicional, fila com prioridade, disco)
public/index.html  página
public/app.js      filtros, consulta e renderização
public/tse.js      configuração das eleições, URLs e normalização do JSON do TSE
public/brancos.*   aba de brancos e nulos por estado e cidade
src/coletor.js     coletor de brancos e nulos por município (acompanhamento a cada 2 min)
src/censo.js       séries do Censo/IBGE (API de agregados), guardadas em dados/censo
src/logs.js        compilação nacional dos logs das urnas (cache em dados/logs)
src/mapas.js       malhas do IBGE para os mapas (cache em dados/mapas)
src/log-urna.js    leitura do logd.dat: tempos por eleitor e resumo da seção
src/sete-zip.js    leitor de 7z (LZMA/LZMA2) em JavaScript puro
public/urnas.*     janela Logs das urnas
public/desktop.*   área de trabalho Windows 98 (gerenciador de janelas, menu Iniciar, barra de tarefas)
public/tema.js     escolhe o visual (98 ou moderno) e o modo "janela" das páginas
public/explorar.*  explorador de variáveis (perguntas prontas, mapa, testes, regressão)
public/mapa.js     mapas coropléticos em SVG (zoom, arrastar, legenda por quantis)
public/calculos.js, graficos.js, comum.js     estatística (incl. testes), gráficos SVG e utilitários
test/              testes (npm test)
```
