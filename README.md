# Apuração Eleições 2026

App para acompanhar e analisar a apuração das **Eleições 2026** (pleito 3220) com os arquivos públicos de resultado
do TSE — <https://resultados.tse.jus.br>, ambiente **oficial**. No menu, as eleições do TSE aparecem juntas por ano e
turno:

| Menu | Códigos do TSE | Cargos |
| --- | --- | --- |
| 2026 · 1º turno (04/10) | 6257, 6259, 6261 | Presidente; Governador, Senador, Deputado Federal, Estadual e Distrital (DF); Conselheiro Distrital de Fernando de Noronha (PE), na abrangência "PE · Fernando de Noronha" |
| 2026 · 2º turno (25/10) | 6258, 6260 | Presidente e Governador (só nos estados com 2º turno) |

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

- **Ícones** (duplo clique; no celular, um toque): Apuração, Brancos e nulos, Painéis, Mapa da votação, Análises, Logs das urnas, Leia-me, TSE, IBGE.
- **Pasta Painéis** (ícone ou menu Iniciar → Programas → Eleições 2026 → Painéis), com dois grupos, e cada painel abre
  numa **janela própria**, com os filtros sincronizados entre as janelas do mesmo grupo:
  - **Geral — todos os dados**: resumo geral, mapa da votação, candidatos, locais vencidos, onde é mais forte e mais
    fraco, partidos, comparação e tabela de locais;
  - **Brancos e nulos**: mapa, resumo, estatísticas, distribuição, dispersão, maiores e menores, por cargo,
    comparação e tabela.
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
- **No site público (Vercel)** não há processo contínuo, e uma função não pode baixar logs depois de responder: os
  logs vêm de uma **base estática** em `public/urnas` (Brasil, cada UF, cada cidade e a lista para o Explorador, no
  formato das rotas `/api/urnas/*`), a mesma para todos os usuários. Os logs não mudam depois de publicados, como o
  resultado: cada seção é baixada **uma vez só**, e **só de cidades com 100% das seções totalizadas** (no dia da
  apuração, cada cidade entra assim que fecha). A base é montada **aos poucos**, para não sobrecarregar o TSE:
  `node scripts/atualizar-urnas.mjs --max-minutos=45 [--ufs=rr,ap] [--turno=2]` (retoma de onde parou) e,
  no GitHub Actions, o workflow **Logs das urnas** faz isso a cada hora (o mais rápido que o TSE aguentar: a concorrência se ajusta sozinha e recua a qualquer 429/5xx; publica a cada 15 min), direto do TSE, gravando o progresso no
  repositório; a partir de 25/10 também o 2º turno (`public/urnas/2t`, pleito 3221). As seções de cada cidade ficam
  em linhas compactas (cerca de 70 bytes cada) que a página expande. Num servidor local, a compilação ao vivo continua
  valendo e a base estática cobre o que ela ainda não leu; "Ler este município agora" só aparece no servidor local.
- Em 2026 o TSE passou a publicar o log como **ZIP** (antes, 7z) e mudou algumas mensagens (o eleitor pode ser
  identificado pelo título ou pelo CPF): os dois formatos são lidos.
- **Mapa por zona eleitoral e local de votação**: ao abrir uma cidade, o mapa a mostra dividida pelas zonas
  eleitorais e, com zoom, pelos locais de votação (clique num local para ver as suas seções na tabela). O TSE não
  publica a área de cada seção; publica onde fica cada local (latitude e longitude) e quais seções votam nele
  (`public/locais/{uf}/{mun}.json`, gerado por `node scripts/atualizar-locais.mjs` a partir do conjunto "Eleitorado
  por local de votação"). A cidade é dividida pela proximidade dos locais (diagrama de Voronoi, `public/voronoi.js`):
  é só uma forma aproximada de ver o mapa e **não entra nas análises**. Por local há tempo na cabine, atendimento e
  % de biometria; os demais indicadores existem por cidade.
- O 7z é aberto por um leitor próprio em JavaScript (`src/sete-zip.js`, LZMA/LZMA2), sem precisar do 7-Zip.
- No Explorador, as variáveis do grupo "Logs das urnas" (tempo médio na cabine, mediana, atendimento, % biometria…)
  aparecem para os locais com logs lidos.

## Exportar e citar

- **Exportar**: todo gráfico e mapa tem botões **PNG** (com título, legenda e crédito) e **SVG** (vetorial). Na
  janela Análises há ainda **Relatório completo** (página HTML com resumo, gráfico, mapa, estatísticas, parâmetros
  e referências, que abre offline e imprime em PDF), **Imprimir / PDF**, **Dados (CSV)** e **JSON** (para reproduzir
  em R ou Python). As demais janelas exportam CSV.
- **Como citar**: antes de cada exportação (e pelo botão "Como citar" em todas as janelas e no menu Iniciar) aparece
  a referência do programa em **ABNT, APA, MLA e Chicago**, mais **BibTeX**, com botão de copiar e as fontes dos
  dados. Dá para marcar "não mostrar de novo hoje". Exemplo (ABNT):

  > MÜLLER-SILVEIRA, Lucas. **Voto Lab**: análise das Eleições 2026 com dados públicos. Versão 1.0. [*S. l.*]: [*s. n.*], 2026. Aplicativo web. Disponível em: &lt;endereço&gt;. Acesso em: &lt;data&gt;.

## Janela Análises (como usar)

1. **Comece com uma pergunta**: perguntas prontas por tema (Comece por aqui, Quem venceu e onde, Sociedade e voto,
   Brancos e nulos, Para especialistas).
2. **Ou monte a sua**: *Onde?* (estados, cidades do Brasil ou de uma UF) → *O que você quer fazer?* (ver no mapa,
   ranking, comparar grupos, relação entre dois dados, descobrir automaticamente, explicar com vários fatores,
   bolsões no mapa, perfis de cidades) → *Com quais dados?* (só os campos que a ação usa, já preenchidos).
3. Cada resultado traz **Em resumo**, **Próximos passos** (um clique para a análise seguinte), as abas Gráfico /
   Mapa / Dados e os botões de exportar. O **Modo especialista** mostra estatísticas descritivas, matriz de
   correlação, distribuição, teste t e o modo arrastar e soltar.

Na primeira vez que o app abre, a área de trabalho mostra a **Apuração** e as **Análises** lado a lado.

## Outras fontes públicas

Além do TSE, o Explorador cruza a eleição com séries públicas, todas baixadas uma vez e guardadas em `dados/`
(em "Mais dados → Fontes públicas", clique numa série ou em "Trazer todas"):

| Fonte | Séries | Como chega |
|---|---|---|
| **TSE · Perfil do eleitorado 2026** (dados abertos) | por município: eleitores, % de mulheres, % de 16–24 anos, % 60+, idade média, % com superior completo, % analfabetos, % sem fundamental completo, % casados, % pretos e pardos (entre quem informou), % com biometria, % com deficiência | retrato em `public/fontes/eleitorado-2026.json` |
| **Ministério da Saúde · CNES/DATASUS** (API de dados abertos do SUS) | unidades básicas de saúde por 10 mil hab., hospitais e CAPS por 100 mil hab., totais | retrato em `public/fontes/saude-cnes.json` |
| IBGE · Censo 2022 | população, densidade, área, alfabetização, % de pardos, pretos, brancos e indígenas, idade mediana, índice de envelhecimento, razão de sexo | agregados v3 (4714, 9543, 9605, 9515), na hora |
| IBGE · Censo 2022 (domicílios) | % de domicílios com esgoto na rede geral, com água da rede geral e com lixo coletado | agregados v3 (6805, 6803, 6892), na hora |
| IBGE · PIB dos Municípios | PIB e PIB por habitante (aprox.) | agregados v3 (5938), na hora |
| IBGE · Censo 2010 | % de católicos, evangélicos e sem religião | agregados v3 (137), na hora |
| IBGE · Localidades | região intermediária, imediata, meso e microrregião de cada cidade (para agrupar) | localidades v1, na hora |
| IPEA · Atlas do Desenvolvimento Humano (2010) | IDHM e componentes, Gini, renda per capita, % de pobres, esperança de vida | Ipeadata OData v4, na hora |
| qualquer tabela do SIDRA | pelo número da tabela, escolhendo variável e categorias | agregados v3 |
| seu próprio CSV | qualquer indicador por código IBGE, código TSE, UF ou nome | — |

As fontes grandes demais para baixar a cada consulta (o perfil do eleitorado tem 408 MB; o CNES é paginado de 20
em 20) vêm como **retratos** prontos em `public/fontes/`, com a data em que foram gerados. Para atualizar:
`NODE_USE_ENV_PROXY=1 node scripts/atualizar-fontes.mjs` (ou `... eleitorado` / `... saude`). O script baixa do perfil
do eleitorado só o trecho de cada UF dentro do zip oficial (requisições com Range) e conta os estabelecimentos do
CNES por município.

As séries prontas acham a variável pelo nome nos metadados; se uma fonte mudar ou sair do ar, só aquela série
falha (com aviso), e o resto continua. Endereços podem ser trocados por variáveis de ambiente: `IBGE_BASE`,
`IBGE_MALHAS`, `IBGE_LOCALIDADES`, `IPEA_BASE`. Resultados de 2022 não estão mais no site de resultados do TSE
(só a eleição em curso); para comparar com 2022 seria preciso importar os arquivos do Portal de Dados Abertos do TSE.

### Análises para todos os níveis

- **Para quem está começando**: perguntas prontas com um clique, "Em resumo" em português e um glossário de cada
  número (média, correlação, p, R², Moran…).
- **Descobertas automáticas**: testa todas as variáveis carregadas contra a escolhida, ordena pelas que mais
  andam juntas (Pearson e Spearman, com p corrigido por Bonferroni) e aponta os locais fora da curva (|z| > 2,5).
- **Padrão no mapa**: I de Moran global (vizinhança rainha, 499 permutações) e LISA — bolsões Alto-Alto,
  Baixo-Baixo e locais destoantes — com o diagrama de Moran e o mapa dos bolsões.
- **Perfis de locais**: k-médias (k-means++ com semente fixa; k de 2 a 6 pela silhueta) sobre características
  padronizadas, com a tabela de médias de cada perfil e o mapa dos grupos.
- **Regressão múltipla com resíduos no mapa**: onde o modelo erra para mais ou para menos (resíduos agrupados
  sugerem variáveis que faltaram).
- E também: correlação, ANOVA, teste t de Welch, ranking, distribuição, matriz de correlação, CSV de tudo.

## Mapa da votação (todos os dados de cada local)

O servidor guarda, para cada estado e cidade, não só brancos e nulos, mas também **os votos de cada candidato e
de cada partido**, comparecimento, abstenção, votos válidos e o **número efetivo** de candidatos e de partidos
(fragmentação do voto, 1/Σp²). Nos cargos de deputado, cada local guarda os 15 candidatos mais votados e todos os
partidos (votos nominais).

A janela **Mapa da votação** (`/candidatos.html`) mostra, por estado, pelas cidades de uma UF ou por todas as
cidades do Brasil:

- **mapa interativo** do candidato (ou partido) mais votado em cada local, com a cor mais forte onde a vitória foi
  mais folgada; ou a votação de qualquer candidato/partido, a margem do 1º sobre o 2º, o comparecimento, os votos
  válidos ou a fragmentação. Clique num estado para ver as cidades;
- "Em resumo" em português, indicadores, ranking dos candidatos e partidos, locais vencidos por cada um,
  onde cada um é mais forte e mais fraco e a **comparação** entre dois (dispersão com correlação);
- tabela com 1º e 2º colocados, margem e comparecimento, e CSV com os votos de todos os candidatos guardados.

No Explorador, essas variáveis aparecem no grupo "Candidatos" de cada cargo (vencedor, partido mais votado,
margem, nº efetivo e a votação de cada candidato e partido), com perguntas prontas como "Quem venceu em cada
cidade?", "A alfabetização muda o voto no líder?" e "Onde o voto para deputado é mais dividido?".

### Divisão das cadeiras (deputados)

Deputados não são eleitos só por serem os mais votados: o sistema é proporcional. Na Apuração, os cargos de deputado
mostram o card **Divisão das cadeiras**, um hemiciclo com um ponto por vaga, como nos gráficos da imprensa:

- por estado: Assembleia Legislativa (Deputado Estadual), bancada na Câmara (Deputado Federal) e Câmara Legislativa
  do DF (Deputado Distrital), lidos do arquivo da UF publicado pelo TSE (vagas do cargo, quociente eleitoral, vagas de
  cada partido ou federação e eleitos por quociente partidário ou por média);
- no Brasil: a abrangência "Brasil — Câmara dos Deputados" soma as 27 bancadas (513 vagas) e "Brasil — todas as
  assembleias", as 26 assembleias (1.035 vagas), com a lista dos eleitos mais votados e a tabela de votos e cadeiras
  por partido;
- alternância "por partido / por federação", maioria absoluta, explicação do sistema e aviso de distribuição
  provisória enquanto a apuração não chega a 100%.

Com a apuração encerrada, `public/resultados/cadeiras-{eleição}-{cargo}.json` (gerado pelo mesmo script dos retratos)
faz o Brasil abrir na hora.

### 2º turno e retratos de resultados

- O 2º turno (25/10/2026) já está configurado: eleições **6258** (Presidente) e **6260** (Governador), códigos
  publicados pelo TSE em `comum/config/ele-c.json`. Até a votação aparecem como "ainda não publicado"; depois, todas as
  janelas passam a mostrá-los (escolha "Presidente — 2º turno" no cargo).
- **Retratos de resultados** (`public/resultados/{eleição}-{cargo}.json`): com a apuração encerrada, o nível
  "Brasil — todas as cidades" abre na hora a partir de um retrato, em vez de baixar milhares de arquivos do TSE a cada
  consulta (o que numa função serverless não termina e ainda faz o TSE responder 429). O app só usa o retrato quando
  ele está completo (todas as seções totalizadas). Para gerar/atualizar:
  `node scripts/atualizar-resultados.mjs` (todos os cargos do 1º turno já têm retrato; veja abaixo o 2º turno).
  Uma UF sozinha também sai do retrato nacional. Os arquivos são compactos: os percentuais são recalculados no
  navegador a partir das contagens (cerca de 40% menores, sem perder informação).

## Ficha do município

A janela **Ficha do município** (`/municipio.html`) reúne tudo sobre uma cidade numa página só: digite o nome (ou
use "Surpreenda-me") e veja

- o resultado do 1º turno para Presidente, Governador e Senador, com os cinco mais votados na cidade comparados com
  o estado e o Brasil (cores dos partidos);
- quem vota (perfil do eleitorado do TSE), comparecimento e votos (posição entre as cidades da UF), população,
  moradia e saneamento (Censo 2022), saúde (CNES), PIB e IDHM;
- para cada indicador, uma barra com a posição da cidade entre todas as do Brasil, o valor da UF e a mediana;
- um "Em resumo" automático com os destaques, e Imprimir / PDF.
- **cidades parecidas**: as seis cidades de perfil mais próximo (percentis de população, densidade, idade, cor,
  alfabetização, saneamento, PIB, IDHM e Gini), com o vencedor para presidente em cada uma; diz se o voto da cidade
  segue ou foge do perfil.

O endereço guarda a cidade (`municipio.html#mun=pe-25313`), então a ficha pode ser compartilhada.

## Publicar no Vercel

O projeto já vem pronto para o Vercel (`vercel.json` + `api/index.js`): os arquivos de `public/` são servidos como
estáticos e as rotas `/api/*` e `/tse/*` rodam numa função serverless na região de São Paulo (`gru1`), perto do
TSE. É só importar o repositório no Vercel, sem build. Diferenças em relação ao servidor no seu computador:

- uma função serverless não fica ligada o tempo todo: a **compilação nacional dos logs** fica desligada (na janela
  Logs, escolha um município e use "Ler este município agora");
- o cache fica em `/tmp`, apagado de tempos em tempos, então a primeira consulta depois de um tempo parado é mais
  lenta; as cidades de um estado vão se completando a cada atualização da página;
- para acompanhar tudo em tempo real (inclusive todos os logs), prefira rodar `npm start` num computador ou num
  servidor sempre ligado (Render, Railway, Fly.io, uma VPS).

### Base compartilhada da apuração (e o 2º turno)

Ninguém consulta o TSE "sozinho":

- **Resultado final (100% das seções totalizadas)**: o app lê os retratos de `public/resultados` (base estática no
  próprio site), e os arquivos do TSE que passam pelo relay `/tse` ficam horas no CDN do Vercel.
- **Durante a apuração**: cada arquivo do TSE é buscado no máximo uma vez a cada 20 s, e o CDN entrega a mesma cópia
  a todos os usuários; a Apuração atualiza a cada 20 s e para sozinha quando o resultado fica final.
- **Montando a base**: `node scripts/atualizar-resultados.mjs --turno 2 --acompanhar` consulta o TSE a cada 20 s,
  congela as cidades que já fecharam e grava o retrato a cada passada, até 100%. `--turno 1` (padrão) faz o mesmo
  para o 1º turno; antes da publicação, o script só avisa que o resultado ainda não saiu.
- **Noite do 2º turno (25/10/2026)**: o workflow `.github/workflows/retratos-apuracao.yml` roda o script a cada
  10 min das 17h à 0h50 (Brasília) e grava os retratos no repositório, e o Vercel publica. Agendamentos só rodam no
  branch padrão; em outro branch, use "Run workflow" na aba Actions.

### Cache dos arquivos no Vercel

No deploy, `scripts/versionar.mjs` (o `buildCommand` do `vercel.json`) copia `public/` para `dist/` e põe `?v=<versão>`
em todas as referências a `.js` e `.css`. Com a versão no endereço, o navegador guarda esses arquivos por um ano sem
perguntar de novo ao servidor; a versão (hash de todo o código) muda a cada deploy com código novo, e as páginas HTML
continuam sem cache, então ninguém fica com arquivos antigos.

## Segurança

- **Sem dependências** externas (nada de npm para auditar ou atualizar): só Node.js 18+.
- **Proxy restrito**: `/tse/*` só busca os arquivos que as páginas usam (resultados, lista de municípios e fotos
  das eleições configuradas); não serve para acessar outros endereços.
- **Arquivos**: só o que está em `public/` é servido (tentativas de `../` são barradas).
- **Robustez**: URLs malformadas respondem 400 em vez de derrubar o servidor; caches em memória têm limite; o leitor
  de 7z recusa arquivos que declaram tamanhos absurdos ("bombas" de compressão).
- **Ações**: pausar/retomar a leitura dos logs só por POST vindo do próprio app (proteção contra CSRF); os demais
  endereços só aceitam GET.
- **Navegador**: Content-Security-Policy (só scripts do próprio app), `nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy` e `Permissions-Policy`, no servidor local e no Vercel (`vercel.json`). Todo texto vindo do TSE é
  escapado antes de entrar na página.
- **Relatos de erro** (`/api/erro`): sem códigos de controle e no máximo 30 por minuto por endereço.
- **Segredos**: o app não usa chaves. Se algum dia usar, guarde em variáveis de ambiente (`.env` está no
  `.gitignore`) e nunca no código ou no chat.
- Os testes em `test/seguranca.test.js` conferem tudo isso (`npm test`).

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
server.js          servidor local (porta, rede, gravação ao sair)
src/aplicacao.js   rotas: estáticos, proxy para o TSE e APIs (/api/estados, /api/municipios, /api/banco, …)
api/index.js, vercel.json   a mesma aplicação como função serverless no Vercel (com os cabeçalhos de segurança)
src/banco.js       banco único dos arquivos do TSE (GET condicional, fila com prioridade, disco)
public/index.html  página
public/app.js      filtros, consulta e renderização
public/tse.js      configuração das eleições, URLs e normalização do JSON do TSE
public/brancos.*   aba de brancos e nulos por estado e cidade
public/cadeiras.js  divisão das cadeiras dos deputados e gráfico de hemiciclo
public/candidatos.*  mapa da votação: candidatos, partidos, vencedor, comparecimento
public/municipio.*   ficha do município (eleição, eleitorado, Censo, saúde e renda de uma cidade)
src/coletor.js     coletor de brancos e nulos por município (acompanhamento a cada 2 min)
src/censo.js       séries do IBGE (Censo, PIB; API de agregados), guardadas em dados/censo
src/fontes.js      IPEA (Atlas do Desenvolvimento Humano) e IBGE Localidades, guardados em dados/fontes
scripts/versionar.mjs  build do Vercel (public/ → dist/ com ?v= nos .js e .css)
scripts/atualizar-resultados.mjs  gera os retratos de public/resultados (todas as cidades de um cargo)
scripts/atualizar-fontes.mjs  gera os retratos de public/fontes (TSE perfil do eleitorado, Saúde/CNES)
public/fontes/     retratos das fontes grandes (JSON por município e UF)
src/logs.js        compilação nacional dos logs das urnas (cache em dados/logs)
src/mapas.js       malhas do IBGE para os mapas (cache em dados/mapas)
src/log-urna.js    leitura do logd.dat: tempos por eleitor e resumo da seção
src/sete-zip.js    leitor de 7z (LZMA/LZMA2) em JavaScript puro
public/urnas.*     janela Logs das urnas
public/desktop.*   área de trabalho Windows 98 (gerenciador de janelas, menu Iniciar, barra de tarefas)
public/tema.js     escolhe o visual (98 ou moderno) e o modo "janela" das páginas
public/explorar.*  janela Análises (perguntas prontas, mapa, testes, regressão)
public/mapa.js     mapas coropléticos em SVG (zoom, arrastar, legenda por quantis; cidade em zonas/locais)
public/voronoi.js  áreas aproximadas dos locais de votação (diagrama de Voronoi)
public/locais/     locais de votação por cidade (posição e seções), de scripts/atualizar-locais.mjs
public/citar.js    "Como citar" (ABNT, APA, MLA, Chicago, BibTeX)
public/exportar.js PNG/SVG de gráficos e mapas, relatório HTML
public/calculos.js, graficos.js, comum.js     estatística (incl. testes), gráficos SVG e utilitários
test/              testes (npm test)
```
