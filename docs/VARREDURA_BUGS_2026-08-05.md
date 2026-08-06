# 🐛 Varredura multi-agente de bugs — 05/08/2026

> Rodada pela primeira vez como ROTINA DE ABERTURA (item 6 do ritual do CLAUDE.md).
> 6 lentes em paralelo (pré-login · telas do imóvel · planos/cobrança · auth dos endpoints ·
> crons · padrão "erro de API silenciado") → **24 achados únicos** → verificação ADVERSARIAL
> (cada achado entregue a um verificador com a missão de REFUTÁ-LO).
>
> ⚠️ **A verificação parou em 8 de 24** — o workflow travou às 20:20 UTC. Os 16 restantes
> estão marcados como NÃO VERIFICADOS: são suspeitas plausíveis, com arquivo e linha, mas
> **não confirmadas**. Não trate como bug provado até verificar.
>
> **Combinado com o dono (05/08): a re-verificação dos 16 entra nas VERIFICAÇÕES INICIAIS da
> próxima sessão.**

## Situação por achado

| Estado | Significado |
|---|---|
| ✅ CORRIGIDO | confirmado e já em produção |
| 🟠 CONFIRMADO | verificado adversarialmente, **ainda não corrigido** |
| ⏳ A VERIFICAR | achado bruto, sem verificação — pode ser falso positivo |

---


## Gravidade CRITICA

### ✅ CORRIGIDO · `api/mp-webhook.js:336`
**PIX/cartão AVULSO recusado ou expirado rebaixa assinante pagante a explorador (guard 'servico' ausente no ramo**

O ramo `status === 'rejected' || 'cancelled'` do mp-webhook só protege compras de PRODUTO (ehProdutoMp). Pagamentos avulsos de SERVIÇO (recarga de crédito, assessoria via PagamentoServico, PIX-anuidade abandonado) têm metadata.tip

*Impacto:* Assinante Investidor Pro/assessorado/clube EM DIA perde o plano pago sem ter cancelado nada: basta tentar pagar uma recarga com cartão recusado, ou gerar um PIX de assess

*Correção:* commit 682c29c — guard `servico` em processarRecusado + gêmeo no reembolso

<sub>lente: planos-cobranca · verificação: CONFIRMADO</sub>


## Gravidade ALTA

### 🟠 CONFIRMADO · `supabase/migrations/20260714_imovel_anexos_dono_arremate.sql:8`
**RLS `imovel_anexos_meu_arremate_delete`: qualquer usuário que se AUTODECLARE arrematante pode apagar os docume**

A policy de DELETE em imovel_anexos libera para quem tem linha em `arrematados` daquele imóvel. Mas o arremate é autoconsentido (sinalizar-arremate.js: 'Autoconsentido: o usuário declara o próprio arremate', sem verificação) — log

*Impacto:* Perda de dado cross-usuário: o edital/matrícula-PDF capturados (cache que alimenta a análise documental de TODOS os usuários e os botões 'Documentos do lote' em ImovelDet

<sub>lente: telas-imovel · verificação: CONFIRMADO</sub>

### 🟠 CONFIRMADO · `api/juridico-lembretes-cron.js:148`
**Reatribuição jurídica grava no banco ANTES de enviar o e-mail — envio falho perde a pasta em silêncio**

No caminho de prazo vencido, o cron PATCHa o caso (novo advogado_id, prazo_juridico +7 dias úteis, juridico_lembretes=0, novo juridico_token) ANTES de chamar enviarEmail. Se o envio falha (r.ok=false — Resend fora, anexo assinado 

*Impacto:* Análise jurídica de cliente pagante fica parada 7+ dias úteis a mais sem ninguém saber: o prazo foi reaberto no banco, o advogado novo não foi comunicado e o alerta ao ad

<sub>lente: crons · verificação: CONFIRMADO</sub>

### ✅ CORRIGIDO · `src/pages/Checkout.jsx:609`
**Checkout: e-mail já cadastrado mostra falso 'Cadastro criado!' e o e-mail de confirmação nunca chega**

criarContaInline (visitante não-logado em plano pago, ex.: assessorado) chama supabase.auth.signUp e só checa `error`. Com 'Confirm email' ligado, o Supabase NÃO retorna erro para e-mail já cadastrado (anti-enumeração): devolve us

*Impacto:* Visitante que já tem conta (e não lembra) tenta comprar um plano pago, vê 'Cadastro criado! Enviamos um e-mail de confirmação para X' (linha 1300-1302) e fica esperando u

*Correção:* commit 4957768 — detecta `identities: []` (e-mail já cadastrado)

<sub>lente: pre-login · verificação: CONFIRMADO</sub>

### ✅ CORRIGIDO · `src/pages/ConviteEquipe.jsx:423`
**ConviteEquipe: cadastro de staff conclui com sucesso falso — RPC de resgate sempre falha sem sessão e duplicat**

finalizarCadastro chama usar_convite_equipe logo após o signUp, mas o RPC (supabase/migrations/seguranca_convites_kyc_enumeracao.sql, linha 18) retorna {ok:false,'não autorizado'} quando auth.uid() é null — e com confirmação de e-

*Impacto:* Convidado (analista/advogado/leiloeiro/admin) completa os 9+ passos com KYC (3 fotos) e vê 'Cadastro concluído! Bem-vindo à equipe' mesmo quando: (a) o e-mail já tinha co

*Correção:* commit 4957768 — só chama o RPC com sessão; sem sessão guarda o token

<sub>lente: pre-login · verificação: CONFIRMADO</sub>

### ✅ CORRIGIDO · `src/contexts/AuthContext.jsx:257`
**Convite de equipe se perde silenciosamente: token descartado mesmo quando o RPC falha, e resgate depende de se**

No SIGNED_IN, o AuthContext chama usar_convite_equipe dentro de try/catch vazio e remove o token do sessionStorage INCONDICIONALMENTE — falha de rede, convite expirado (default 7 dias em add_validade_convite_equipe.sql) ou RPC neg

*Impacto:* Convidado da equipe termina como 'explorador' sem nenhum aviso — nem ele nem o dono sabem que o convite não foi aplicado. Como o token foi removido, um simples relogin nã

*Correção:* commit 4957768 — token só descartado com desfecho definitivo

<sub>lente: pre-login · verificação: CONFIRMADO</sub>

### 🟠 CONFIRMADO · `src/pages/Painel.jsx:447`
**Painel '✅ Arrematei!' registra arremate com id LOCAL (tsn_...) e fora do fluxo sinalizar-arremate — retenção c**

O botão '✅ Arrematei!' do Painel (tela antiga, mas ainda ativa: Busca.jsx:1242 e Checkout.jsx:461 navegam para /painel) chama marcarArrematado(im) SEM exigir os 3 relatórios e leva a Arrematados/NovoArrematado, que insere DIRETO e

*Impacto:* Cliente que registrou o arremate pelo Painel: (1) segue recebendo e-mail/push 'Confirme seu arremate' e, vencida a carência, os DOCUMENTOS do imóvel são APAGADOS pela lim

<sub>lente: telas-imovel · verificação: CONFIRMADO</sub>

### ✅ CORRIGIDO · `api/mp-webhook.js:314`
**Pro ANUAL pago via PIX pode nunca ativar: falha na ativação deixa a marca de idempotência 'approved' e o reenv**

O caminho server-side resiliente do plano anual (webhook) grava DUAS marcas de idempotência: evento=status ('approved', linha 265) e evento='pix_plano_anual' (linha 307). Se ativarPlanoDireto falhar, o catch interno remove SÓ a ma

*Impacto:* Cliente paga R$ 449,90 de anuidade no PIX e fecha o navegador (exatamente o cenário que este caminho existe para cobrir, segundo o comentário das linhas 289-293). Se a 1ª

*Correção:* commit 4957768 — as duas marcas de idempotência caem no erro + rede de segurança no reconciliar-cron

<sub>lente: planos-cobranca · verificação: CONFIRMADO</sub>

### ⏳ A VERIFICAR · `api/agendar-ciclo.js:109`
**agendar-ciclo: PATCH de ciclo_agendado engolido depois de já ter cancelado a renovação anual nos gateways**

O endpoint primeiro CANCELA os mandatos anuais no Mercado Pago e Asaas (passo 1, linha 95) e confirma o cancelamento (passo 2), mas o passo 3 — gravar perfis.ciclo_agendado='mensal', que é o que materializa a mensal no vencimento 

*Impacto:* Efeito irreversível já aconteceu ANTES da escrita não verificada: a auto-renovação anual foi cancelada nos dois gateways. Se a intenção 'mensal' não ficou gravada, no ven

<sub>lente: fetch-sem-ok · verificação: NAO VERIFICADO</sub>


## Gravidade MEDIA

### ⏳ A VERIFICAR · `api/sinalizar-arremate.js:70`
**sinalizar-arremate devolve ok:true sem checar se o INSERT em `arrematados` funcionou — 'Arremate confirmado ✓'**

O POST em `arrematados` (e os PATCH de imovel_anexos/doc_retencao_aviso) não têm a resposta verificada: se o insert falhar (constraint, coluna, indisponibilidade do PostgREST), o handler segue e retorna `{ok:true}` — o botão vira 

*Impacto:* Padrão falso-sucesso do dono: o cliente acredita que o arremate está registrado (e que os documentos estão protegidos da retenção), mas se o insert falhou não há linha em

<sub>lente: telas-imovel · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/monitor-dados-cron.js:38`
**monitor-dados-cron lê a RPC sem checar r.ok — se a RPC falhar, o monitor de regressão responde ok:true sem mon**

`stats = await r.json()` sem verificar `r.ok`. Quando a RPC stats_completude_imoveis falha (404 se a função sumir numa migração, 500, timeout do statement, key inválida), o PostgREST devolve um corpo de ERRO em JSON ({code,message

*Impacto:* O alarme que existe para avisar 'o scraper de uma fonte quebrou e está gravando campo vazio em massa' se auto-silencia justamente quando o próprio pipeline de medição que

<sub>lente: crons · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/verificar-cpf.js:100`
**verificar-cpf ignora roles com sufixo _anual: assinante anual é orientado a 'assinar o Pro' que já paga**

O check de acesso a plano compara perfis.role cru contra a hierarquia ['explorador','top2','assessorado','clube']. Roles anuais existem no banco ('top2_anual' etc. — vide api/_webhook-core.js:36 RANK_PLANO e reconciliar-assinatura

*Impacto:* No funil da assessoria (Checkout.jsx IdentificacaoCpfAssessoria, linha 94), o assinante Pro ANUAL digita o CPF e recebe nivel='explorador' com CTA 'Entrar e assinar o Pro

<sub>lente: pre-login · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/monitor-fontes-cron.js:409`
**monitor-fontes-cron marca o alerta como 'enviado' mesmo quando o e-mail falhou (ou sem RESEND_KEY) — problema **

O envio ao Resend está dentro de `if (enviar && RESEND_KEY)` com try/catch vazio e SEM checar a resposta HTTP; logo abaixo, `if (enviar) await gravarEstadoAlerta(...)` grava assinatura + enviado_em incondicionalmente. Se o fetch f

*Impacto:* O 'bug bounty dos leiloeiros' automático perde a boca: uma fonte degradada (ex.: cobertura de matrícula despencou) cujo primeiro e-mail caiu num soluço do Resend nunca ch

<sub>lente: crons · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `src/pages/Arrematados.jsx:67`
**Registrar revenda: parse remove TODO separador ('320.000,00' vira R$ 32.000.000) — gabarito de calibração corr**

enviarRevenda converte o valor com `replace(/[^\\d]/g,'')`, que trata separador decimal como dígitos: qualquer valor digitado com centavos infla 100×. O resto da mesma tela parseia certo (addLanc linha 152 e NovoArrematado linha 4

*Impacto:* Usuário que digita 'R$ 320.000,00' registra revenda de R$ 32 milhões: (1) `arrematados.revenda_valor` — o gabarito que o dono usa para calibrar a precisão das estimativas

<sub>lente: telas-imovel · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/financiamento-alertas-cron.js:55`
**Lembrete de parcela de financiamento sem idempotência e sem retomada: match exato com a data de hoje, nenhum e**

O e-mail de PARCELA dispara quando `dtStr === hoje` e nada é gravado depois do envio — a tabela financiamentos só tem o flag notificado_sinal (migração add_financiamento_tracker.sql:22), nenhum estado por parcela. Duas execuções n

*Impacto:* Cliente que configurou lembrete de vencimento ('Este lembrete foi configurado por você na plataforma') pode receber o mesmo aviso 2x no dia (parece bug/spam) ou — no cená

<sub>lente: crons · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/mp-webhook.js:294`
**Recarga de crédito paga sem entrega se o cliente sair antes da confirmação: webhook não credita proposito='rec**

A confirmação da recarga é 100% client-side: só /api/creditos-recarga (chamado pelo onPago do front em Creditos.jsx) executa creditar_credito. No webhook, o ramo 'approved' tem caminho server-side resiliente para proposito='plano_

*Impacto:* Cliente paga a recarga (cartão que entra 'in_process' e aprova depois que ele fechou a aba, ou a chamada /api/creditos-recarga falha por rede — o front então mostra 'fale

<sub>lente: planos-cobranca · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/gerar-analise.js:1487`
**'Regerar' o relatório Mercadológico APAGA o resultado anterior no início da geração e não o restaura em falha **

gerar-analise faz upsert com `result: null` logo no início de TODA geração (inclusive regeração). Se a geração falhar (timeout, anthropic_http_*, rede), o catch grava `status:'erro'` sem restaurar o result — o relatório mercadológ

*Impacto:* Cliente com o mercadológico pronto clica 'Regerar' (botão exposto quando c.ok, Analise.jsx:1659); se a API do modelo/busca falhar por motivo ≠ timeout (429, 5xx, rede), e

<sub>lente: telas-imovel · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/marcar-posse.js:58`
**marcar-posse: rebaixa o role do cliente assumindo que o PATCH da posse funcionou (nenhuma escrita é verificada**

O PATCH que grava posse_em/status_etapa em `casos` (linhas 58-61) não tem a resposta checada; logo em seguida o código reavalia o plano e pode fazer PATCH de perfis.role para 'explorador' (linha 83, também sem checagem), devolvend

*Impacto:* Se o PATCH em casos falhar silenciosamente e este era o último caso do assessorado, a reavaliação segue mesmo assim e rebaixa o cliente para 'explorador' com o caso AINDA

<sub>lente: fetch-sem-ok · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/mp-webhook.js:365`
**Reembolso de pagamento avulso de SERVIÇO (recarga/assessoria) suspende o plano do assinante — mesmo guard ause**

No ramo 'refunded'/'partially_refunded', só compras de PRODUTO são isentas (ehProdutoMp). Um reembolso de pagamento avulso com metadata.tipo='servico' (ex.: suporte devolve uma recarga de crédito ou uma assessoria avulsa) cai em p

*Impacto:* Ação administrativa legítima (devolver uma recarga de R$ 50 pelo painel do MP) derruba o plano pago do cliente: role vira explorador, âncora do anual (plano_vencimento) é

<sub>lente: planos-cobranca · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/verificar-pagamento.js:48`
**IDOR condicional em verificar-pagamento.js: usuário sem asaas_id lê status/vencimento de cobrança/assinatura A**

A checagem de dono do pagamento/assinatura só roda QUANDO o usuário autenticado já tem asaas_id. Para qualquer conta sem asaas_id (todo Explorador grátis e qualquer conta antes do 1º pagamento), a verificação de propriedade é PULA

*Impacto:* Vazamento cross-tenant: qualquer usuário logado (basta uma conta grátis, cujo perfis.asaas_id é sempre null) consegue consultar, iterando paymentId/subscriptionId do Asaa

<sub>lente: api-auth · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `src/pages/Checkout.jsx:307`
**URL /checkout?plano=clube&status=approved dispara 'Pagamento aprovado' + contrato do Clube sem nenhum pagament**

O Checkout confia cegamente no query param do redirect do MP: `status=approved` chama confirmarPagamento(), que mostra a tela 'Pagamento aprovado!', grava um aceite (registrar-aceite) e, para assessorado/clube, chama /api/auto-con

*Impacto:* Qualquer usuário logado (até explorador) que abra a URL com status=approved — link compartilhado, histórico do navegador, ou por curiosidade — vê 'Pagamento aprovado!', t

<sub>lente: planos-cobranca · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/leiloeiro-cadastro.js:64`
**Link de cadastro do leiloeiro reativa parceiro desativado pelo admin (status:'ativo' incondicional)**

O POST público (só exige o token do link, que nunca expira nem rotaciona) grava status:'ativo' incondicionalmente; o único status bloqueado é 'suspenso' (linha 48). O Admin trabalha com 'pendente'/'inativo'/'suspenso' (Admin.jsx:6

*Impacto:* O dono desativa um leiloeiro parceiro (feed some da busca) e o parceiro — ou qualquer um que tenha o link, que a própria página manda 'entregar ao TI' — reenvia o formulá

<sub>lente: pre-login · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `src/pages/Login.jsx:338`
**Plano escolhido se perde após a confirmação de e-mail — promessa de 'direcionar ao pagamento' quebra**

No cadastro com ?plano=X, o plano é guardado em sessionStorage ('tsn_plano_pendente') e a tela de sucesso promete 'Após o login você será direcionado para o pagamento' (linha 399). Mas o link de confirmação de e-mail abre em OUTRA

*Impacto:* Funil de venda: quem escolhe um plano pago, cria conta e confirma o e-mail no caminho mais comum (clicar no link do e-mail) já entra logado na Home SEM ser levado ao chec

<sub>lente: pre-login · verificação: NAO VERIFICADO</sub>

### ⏳ A VERIFICAR · `api/juridico-lembretes-cron.js:137`
**Escalação ao admin repete TODO dia útil: select não traz juridico_escalado_admin, o flag de dedup nunca é lido**

O guard `if (!caso.juridico_escalado_admin)` deveria escalar 1x só, mas o SELECT dos casos (linha 120) não inclui a coluna juridico_escalado_admin (existe no banco: supabase/migrations/analises_e_auditoria.sql:65). `caso.juridico_

*Impacto:* Todo caso que bateu o teto de 3 reatribuições gera uma mensagem duplicada no chat interno POR DIA ÚTIL, para sempre (o caso continua em_revisao até intervenção manual). O

<sub>lente: crons · verificação: NAO VERIFICADO</sub>
