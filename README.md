# Monitor SEFAZ — disponibilidade de NF-e / NFC-e

Dashboard estilo status page que consulta, em tempo real, o webservice
oficial `NFeStatusServico4` de cada Secretaria de Fazenda estadual e
mostra o resultado em painel verde/amarelo/vermelho, seguindo a mesma
lógica do Portal Nacional da NF-e em
[Consultar Disponibilidade](https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx).

## O que este projeto faz

O objetivo é levantar o estado dos autorizadores da NF-e e NFC-e e
expor um JSON de status para o frontend. Em termos práticos, o backend
faz um `POST` SOAP para cada UF, lê a resposta XML e interpreta o
campo `cStat`.

- `107` = serviço em operação (verde)
- `108` / `109` = serviço indisponível ou em parada (vermelho)
- falta de resposta, timeout ou erro de TLS/SSL = falha de transporte,
  normalmente mostrada como amarelo/vermelho no estado do monitor

## Por que ele precisa de backend

Um navegador puro não consegue consultar esses webservices diretamente
porque:

1. os endpoints da SEFAZ não liberam CORS para chamadas do cliente;
2. o serviço usa SOAP XML e não uma API REST JSON simples;
3. há muitas peculiaridades de TLS e namespaces que só podem ser
   tratadas no servidor Node.

Por isso o projeto é dividido em:

- `server/` — consulta SOAP, interpreta respostas e mantém o estado em
  memória;
- `public/` — painel web estático servido pelo próprio Node.

Em produção, quando um autorizador bloqueia o SOAP direto por HTTP 403 ou
exige certificado de cliente, o monitor usa como fallback a tabela oficial de
disponibilidade do Portal Nacional da NF-e. O snapshot informa `source:
"Portal Nacional"` nesses casos. Para exigir somente SOAP direto, defina
`SEFAZ_PORTAL_FALLBACK=false`.

## Requisitos

- Node.js 18+
- acesso externo à internet para alcançar os endpoints da SEFAZ
- cadeia raiz confiável do ambiente (em muitos casos, a falha real é SSL)

## Como rodar

```bash
npm install
npm start
```

Acesse:

- http://localhost:3000

## Verificação rápida do funcionamento

Depois de subir o servidor, confirme o health check:

```bash
curl http://localhost:3000/api/health
```

E o snapshot atual do monitor:

```bash
curl http://localhost:3000/api/status
```

Se o endpoint retornar dados, o backend está consultando. Se a resposta
for vazia ou mostrar todas as UFs como erro de rede/SSL, o problema mais
provável está no TLS/CA do ambiente e não no front-end.

## Problema mais comum: TLS/CA da SEFAZ

Se você ver erros como `fetch failed`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`,
`unable to get local issuer certificate` ou inúmeras UFs falhando ao mesmo
tempo, a causa mais comum é a cadeia de certificados do ambiente.

As SEFAZ brasileiras ainda têm muitos endpoints que usam certificados
antigos ou cadeias com a ICP-Brasil. Em geral, isso não é um erro de
mapeamento de UF nem de XML. É um problema de confiança do certificado
na máquina em que o Node está rodando.

### Opção recomendada: apontar a CA correta

Use um bundle PEM válido da cadeia da ICP-Brasil ou da raiz que a sua
máquina confia.

Linux/macOS:

```bash
export NODE_EXTRA_CA_CERTS=/caminho/para/icpbrasil-ca.pem
npm start
```

Windows PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\caminho\icpbrasil-ca.pem"
npm start
```

Também é possível usar a variável específica do projeto:

```env
NODE_EXTRA_CA_CERTS=/caminho/para/icpbrasil-ca.pem
```

ou

```env
SEFAZ_CA_FILE=/caminho/para/icpbrasil-ca.pem
```

### Compatibilidade de TLS legado

Se o ambiente for muito antigo, pode ser necessário ativar o fallback:

```env
SEFAZ_ALLOW_LEGACY_TLS=true
```

Esse modo reduz o nível de segurança do cliente para aceitar TLS mais
antigo. Ele serve como workaround, mas não substitui a correção correta
na cadeia de certificados.

## Variáveis de ambiente

Você pode colocar as configurações em um arquivo `.env` ou exportá-las no
terminal antes do `npm start`:

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta do servidor HTTP |
| `SEFAZ_AMBIENTE` | `producao` | `producao` ou `homologacao` |
| `CHECK_INTERVAL_MS` | `180000` | Intervalo entre verificações |
| `CHECK_CONCURRENCY` | `6` | Quantidade de UFs consultadas em paralelo |
| `SEFAZ_PORTAL_FALLBACK` | `true` | Usa a disponibilidade oficial do Portal Nacional quando o SOAP direto é bloqueado |
| `SEFAZ_HISTORY_TIME_ZONE` | `America/Sao_Paulo` | Fuso usado para agrupar o histórico por dia e mês |
| `NODE_EXTRA_CA_CERTS` | — | Bundle PEM com a CA raiz correta |
| `SEFAZ_CA_FILE` | — | Bundle PEM específico do projeto |
| `SEFAZ_ALLOW_LEGACY_TLS` | `false` | Habilita compatibilidade com TLS legado |

## Verificando a conexão direto no endpoint

Antes de debugar o código, vale confirmar que a SEFAZ responde no
endpoint itself. Exemplos:

```bash
openssl s_client -connect nfe.sefaz.go.gov.br:443 -servername nfe.sefaz.go.gov.br
```

ou:

```bash
curl -I https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4
```

Se a conexão falhar antes mesmo do SOAP, o problema está no TLS/CA ou em
bloqueio de rede; se a conexão for aceita e o XML vier, então o backend
está no caminho certo.

## De onde vêm os dados

- `server/config/endpoints-nfe.json` e `server/config/endpoints-nfce.json`
  contêm os URLs do serviço `NFeStatusServico4` por UF;
- `server/config/ibge-codes.json` e `server/soapClient.js` fazem o
  mapeamento de UF e ajustes de namespace/WS;
- os dados são interpretados conforme a tabela oficial de status da NF-e,
  onde `cStat=107` significa serviço em operação.

⚠️ Os endpoints da SEFAZ mudam com o tempo. Este projeto inclui uma
base atual, mas em produção contínua vale revalidar os URLs contra a
página oficial da Fazenda:
[webServices.aspx](https://www.nfe.fazenda.gov.br/portal/webServices.aspx)

## Estrutura do projeto

```text
sefaz-monitor/
├── package.json
├── README.md
├── .env.example
├── server/
│   ├── index.js
│   ├── historyStore.js
│   ├── soapClient.js
│   ├── stateEngine.js
│   └── config/
│       ├── endpoints-nfe.json
│       ├── endpoints-nfce.json
│       ├── ibge-codes.json
│       └── uf-meta.json
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── node_modules/@svg-maps/brazil/
│   └── brazil.svg  (mapa interativo dos 27 estados, instalado via npm)
├── data/
│   └── monitor-sefaz.sqlite  (banco SQLite gerado em runtime)
└── test/
  ├── historyStore.test.js
  ├── snapshotStatus.test.js
  └── soapClient.test.js
```

## API exposta pelo backend

- `GET /api/health` — health check
- `GET /api/status` — snapshot atual do monitor
- `GET /api/history` — histórico mensal, agrupado por dia, de coletas por UF
- `POST /api/refresh` — solicita uma nova rodada respeitando o intervalo configurado

O servidor também publica o mapa em `/vendor/svg-maps-brazil/brazil.svg` para
uso pelo frontend.

## Histórico mensal e gráficos

Cada ciclo concluído grava uma amostra por documento e UF em
`data/monitor-sefaz.sqlite`. O banco possui uma linha por coleta, documento e
UF, incluindo `latencyMs`, classificação, `cStat`, estado e fonte. O endpoint
`GET /api/history` mantém o formato mensal agrupado por dia esperado pelo
frontend.

Na primeira inicialização, arquivos legados `data/status-history-YYYY-MM.json`
são importados automaticamente para o SQLite. Depois da validação da migração,
esses arquivos podem ser removidos; novas coletas não recriam JSON.

As classificações de tempo são: `Normal` (até 2 s), `Lento` (até 5 s), `Muito
Lento` (abaixo de 30 s), `Timeout` (30 s ou mais) e `Erro` (sem retorno).

O painel apresenta o mapa interativo como visão principal, sem uma grade de
cards duplicada. Cada estado mostra sua sigla e o último tempo de resposta; o
clique abre os detalhes e filtra os gráficos automaticamente.

Os gráficos permitem selecionar a UF e o tipo de documento e apresentam três
visões simultâneas, todas com as faixas coloridas de tempo:

- a cada consulta: janela rolante fixa dos últimos 30 registros, em intervalos
  de 3 minutos por padrão;
- por hora: as 24 horas do dia atual, inclusive horas sem coleta;
- por dia: os dias do mês atual até o dia vigente, inclusive dias sem coleta.

As barras partem do zero e terminam no limite da faixa: Normal até 2 s, Lento
até 5 s, Muito Lento até 30 s, Timeout na faixa superior e Erro quando não há
retorno.

## Limitações conhecidas

- O backend consulta apenas `NFeStatusServico4`, serviço público e não
  fiscal;
- alguns estados usam namespaces SOAP ligeiramente diferentes, e o cliente
  já tenta variantes comuns;
- o snapshot corrente fica em memória, mas o histórico mensal agrupado por dia
  é persistido em `data/monitor-sefaz.sqlite`;
- o comportamento real depende fortemente da cadeia raiz e da qualidade da
  conexão com a internet do servidor.

## Iniciar automaticamente no boot do Windows (sem login)

Para o monitor sobreviver a reinícios do Windows mesmo sem nenhum usuário
fazer login, use os scripts em `scripts/`, que registram uma Tarefa Agendada
disparada em "At startup" (não "at logon"):

- `scripts/start-monitor-service.cmd` — inicia o Node do projeto e grava log
  em `logs/monitor-sefaz.log`;
- `scripts/install-scheduled-task.ps1` — registra a tarefa `MonitorSefaz`
  rodando sob a conta `SYSTEM`;
- `scripts/install-scheduled-task-user.ps1` — alternativa que registra a
  mesma tarefa sob a sua própria conta de usuário (via `Get-Credential`),
  útil quando um antivírus/EDR bloqueia processos disparados pela conta
  `SYSTEM` a partir de uma pasta fora de `Program Files`.

Execute UMA VEZ, em um PowerShell aberto como Administrador:

```powershell
cd C:\MonitorSefaz\monitorSefaz
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-scheduled-task.ps1
```

Confirme com `Get-ScheduledTaskInfo -TaskName MonitorSefaz` que
`LastTaskResult` é `0` (concluído) ou `267009`/`0x00041301` (tarefa em
execução contínua, esperado para um serviço que nunca termina sozinho).

## Diagnóstico rápido se nada aparecer

1. confirme que o Node subiu sem erro de TLS ao iniciar;
2. veja se o `GET /api/health` responde;
3. teste `GET /api/status` e observe se há `erro`/`transportClass` em
   várias UFs;
4. se a maioria dos erros for `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, a
   correção é instalar a CA correta ou definir `NODE_EXTRA_CA_CERTS`;
5. se o erro for de timeout ou `ECONNREFUSED`, então o problema é rede,
   firewall ou endpoint não acessível pela máquina.

Esse fluxo garante que você saiba se o problema é de conexão, TLS ou de
configuração do próprio SOAP.
