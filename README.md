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
e `TSE_BASE` (padrão `https://resultados.tse.jus.br/oficial`).

## O que o app mostra

- Filtros de **eleição**, **cargo**, **abrangência** (Brasil, UF, Exterior) e **município**.
- Percentual de **seções totalizadas** e horário da última atualização do TSE.
- **Candidatos** ordenados por votos, com foto, partido, vice e situação (Eleito, 2º turno…).
  Nos cargos proporcionais a lista é compacta, com busca e paginação, e há um quadro de votos nominais por partido.
- **Dados gerais**: eleitorado, comparecimento, abstenção, válidos, brancos e nulos.
- **Atualização automática** a cada 60 s (pausa com a aba em segundo plano) e botão de atualizar.
- A seleção fica na URL (`#ele=6259&cargo=0&abr=sp`), então dá para compartilhar o link.

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
server.js          servidor estático + proxy com cache para o TSE + API /api/estados e /api/municipios
public/index.html  página
public/app.js      filtros, consulta e renderização
public/tse.js      configuração das eleições, URLs e normalização do JSON do TSE
public/brancos.*   aba de brancos e nulos por estado e cidade
src/coletor.js     coletor de brancos e nulos por município (acompanhamento a cada 2 min)
test/              testes (npm test)
```
