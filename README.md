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
server.js          servidor estático + proxy com cache para o TSE
public/index.html  página
public/app.js      filtros, consulta e renderização
public/tse.js      configuração das eleições, URLs e normalização do JSON do TSE
test/              testes (npm test)
```
