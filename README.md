# Sympla Agendador

Serviço Node.js que solicita a sincronização existente na Locaweb por POST HTTPS. Executa imediatamente ao iniciar e espera o intervalo **após terminar** cada ciclo. Funciona continuamente sem navegador, sessão PHP, dashboard, banco local ou acesso direto à API Sympla. Não altera o PHP.

## Preparar e executar

Requer Node.js 22 ou superior. Não há dependências externas. Na raiz do projeto:

```powershell
# Windows PowerShell (npm.cmd evita bloqueio do npm.ps1)
npm.cmd ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

```sh
# Linux
npm ci
cp .env.example .env
chmod 600 .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Guarde a chave de 96 caracteres gerada em local seguro. Edite `SYNC_WEB_KEY` no `.env` e configure **a mesma chave** no `.env` do sistema PHP na Locaweb. Não substitua uma chave existente sem coordenar todos os consumidores. Nenhuma credencial real acompanha este projeto.

Configure:

| Variável | Padrão | Regra |
| --- | --- | --- |
| SYNC_URL | SEU URL | HTTPS, sem credenciais ou parâmetros |
| SYNC_WEB_KEY | sem padrão válido | mínimo 48 caracteres ASCII sem espaços |
| SYNC_INTERVAL_SECONDS | 300 | inteiro entre 60 e 86400 |
| SYNC_TIMEOUT_MS | 240000 | inteiro entre 1000 e 900000 |
| SYNC_MAX_RETRIES | 2 | inteiro entre 0 e 5, além da primeira tentativa |
| TZ | America/Sao_Paulo | horários dos logs sempre neste fuso |
| AUTO_SYNC_SECONDS | 0 | copie o valor real da Locaweb; 0 a 86400 |

O intervalo deve ser maior ou igual ao `AUTO_SYNC_SECONDS`. Não é possível descobrir esse valor remotamente: confirme no ambiente PHP. O Node carrega `.env` nativamente, a partir da raiz do projeto, mesmo quando iniciado dentro de src; variáveis do processo têm precedência. Reinicie o serviço após alterações.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd start
```

No Linux, use `npm` em lugar de `npm.cmd`. O comando `check` valida a configuração sem fazer requisições. `start` dispara uma sincronização real imediatamente. Encerre com Ctrl+C ou SIGTERM.

## Publicar na Discloud

1. Execute os testes e `check` localmente com sua configuração.
2. Confirme a chave, a URL, o intervalo PHP e o contrato de resposta com o responsável pela Locaweb.
3. Mantenha uma única aplicação e uma única réplica ativa para esse endpoint. Pare agendadores antigos antes de ativar este.
4. Crie um ZIP com `src`, `package.json`, `package-lock.json` e `discloud.config` diretamente na raiz do arquivo. Pode incluir README e testes. Não inclua `.git`, dependências ou logs.
5. Configure as variáveis de ambiente pelo mecanismo privado disponível em sua conta. Caso sua modalidade de upload não ofereça esse recurso, inclua um `.env` configurado apenas no pacote privado enviado à hospedagem. Nunca publique esse pacote ou `.env` em Git, links públicos ou mensagens. A presença de um arquivo oculto no ZIP deve ser conferida, especialmente no Windows.
6. Envie o ZIP pela opção de upload do painel Discloud e inicie a aplicação. Use Node 22, tipo `bot`, entrada `src/index.js` e 100 MB de RAM, conforme o arquivo fornecido.
7. Confirme nos logs `service_started`, `sync_start`, `sync_end` e `next_cycle`. Confira também a última atualização no painel/banco da Locaweb por seus recursos administrativos existentes.
8. Feche o navegador e confirme posteriormente novas execuções nos logs. A continuidade depende da aplicação ativa e dos recursos do plano.

`AUTORESTART=true` é uma diretiva documentada, disponível no plano Platinum ou superior. Confirme que seu plano a suporta; em outro plano, remova essa linha e verifique as opções de recuperação oferecidas pela hospedagem. Não se presume reinício automático onde o plano não o garante. A versão 22 é solicitada explicitamente; confirme a disponibilidade ao publicar.

Referências consultadas: [discloud.config](https://docs.discloud.com/configurations/discloud.config), [hospedagem de bots](https://docs.discloud.com/how-to-host/bots) e [configurador oficial](https://discloud.com/discloud.config). O serviço não necessita domínio nem servidor HTTP público.

## Testar pelo Postman

Com o agendador parado, crie uma requisição POST para a URL configurada. Na aba Authorization escolha Bearer Token e use uma variável privada contendo `SYNC_WEB_KEY`. Adicione `Accept: application/json`, deixe o corpo vazio e mantenha a validação TLS ligada. Envie uma vez e inspecione status e JSON. Essa chamada executa a sincronização real. Não compartilhe tokens, exportações com segredos ou respostas com dados pessoais.

## Respostas e contrato pendente

`interpretResponse`, em `src/syncClient.js`, isola o contrato provisório. Confirme os nomes, tipos e significado destes campos antes de considerar o resultado uma confirmação integral:

- `success: true`, `ok: true` ou `status: "success"`: confirmação de sucesso.
- `success: false`, `ok: false`, valores 0 ou `"false"`, `status` igual a `error`, `failed` ou `failure`, `error` preenchido ou `errors` preenchido: erro de negócio prevalece sobre sucesso.
- `processed` ou `participants_processed`: contagem inteira não negativa, somente se fornecida. Confirme se representa processados, importados ou total; não são equivalentes.
- Outros formatos: `unconfirmed`. JSON inválido ou vazio: `invalid_json`. HTTP 2xx sozinho não confirma sincronização. O cliente aceita no máximo 64 KiB por resposta; o PHP idealmente deve retornar um resumo sem participantes.

Confirme também respostas de sincronização já em andamento, cooldown, execução parcial e a atomicidade do bloqueio no `SyncService.php`. Não há alteração desses arquivos nesta entrega.

## Falhas, concorrência e encerramento

Cada chamada termina antes da próxima. Não há fila nem `setInterval`. 500/502/503/504/429 permitem até duas retentativas por padrão, com espera mínima do intervalo normal e backoff de 60 segundos multiplicado por 2 a cada retentativa. `Retry-After` válido, em segundos ou data HTTP, aumenta a espera, inclusive após esgotar as retentativas. Um cabeçalho inválido usa a espera normal.

401/403, erro de negócio, JSON inválido, timeout e falha de rede não têm retentativa imediata; o serviço volta a tentar no próximo ciclo normal. Corrija autenticação antes de reiniciar. Timeout ou desconexão não provam que o PHP parou: o servidor pode continuar processando. Até erros 5xx podem ocorrer após efeitos parciais; mantenha o bloqueio e a idempotência do PHP e use `SYNC_MAX_RETRIES=0` se essas garantias não estiverem confirmadas. Redirecionamentos não são seguidos para evitar encaminhar o token.

Uma porta TCP exclusiva em `127.0.0.1:43781` impede dois processos no mesmo espaço de rede. Não é um endpoint HTTP e não é exposta externamente. Um conflito gera `instance_already_running`. O sistema operacional libera a porta após queda do processo, permitindo reinício sem trava obsoleta. **Isso não bloqueia réplicas em contêineres/máquinas distintas.** Uma única réplica e o bloqueio existente no PHP são necessários para proteção distribuída; não é possível garantir execução única entre máquinas só com um processo local.

SIGINT/SIGTERM interrompem esperas, abortam a requisição local, aguardam sua conclusão e liberam a porta. Abortar localmente não cancela o trabalho remoto. Falhas inesperadas encerram com código 1 para permitir recuperação pela hospedagem.

## Logs e diagnóstico

Consulte o console local ou os logs da aplicação no painel Discloud. Cada linha JSON contém horário de São Paulo, evento e campos controlados de duração, status, resultado, quantidade quando informada e próxima tentativa. Respostas, mensagens arbitrárias do servidor, URL e exceções não são registradas, evitando vazamento de token e dados pessoais. Não há retenção local nem envio para monitoramento externo.

Procure o último `sync_end` com `result: "success"`. Isso registra a confirmação segundo o contrato provisório, não uma auditoria de todos os participantes. Valide a última sincronização no painel existente da Locaweb. `unconfirmed` exige revisar o contrato; `business_error` exige investigar o PHP por seus logs privados.

Para 401/403, confira a mesma chave nos dois ambientes. Para 429, aguarde a próxima tentativa indicada. Para 5xx, investigue a saúde e os logs PHP. Para timeout/rede, verifique DNS, certificado, disponibilidade e limites de execução; não desative TLS. Para JSON inválido, confira redirecionamento para login, erro HTML ou saída PHP indevida. Para falha ao iniciar, execute `npm run check`, confira nomes/limites das variáveis, Node 22+, diretório atual e integridade do `.env`; valores não são impressos por segurança. Verifique também conflito na porta local.

Os testes usam o executor nativo do Node e respostas em memória, sem chamar Sympla ou Locaweb. Cobrem autenticação, configuração, HTTP, JSON, timeout, rede, retentativas, exclusão mútua, continuidade, encerramento e ausência de dados sensíveis nos logs. A validação real do endpoint e do plano Discloud depende do ambiente de produção e não faz parte dos testes simulados.

