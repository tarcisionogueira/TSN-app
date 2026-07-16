# 🗺️ HANDOFF — BidPro Brasil (continuação em nova sessão)

> Cole este documento no início de uma nova sessão do Claude Code (com o **conector Supabase ativo**) para continuar com acesso total ao banco. Peça primeiro uma **auditoria completa dos fluxos** e depois siga pelos "Próximos passos".

> 📋 **Pendências que dependem do DONO** (painéis/planos): ver `docs/PENDENCIAS_DONO.md`. Ao iniciar sessão, se o dono perguntar "o que falta que depende de mim?", liste de lá. Hoje: Asaas (reativar webhook), Upstash (provisionar, grátis), e — quando crescerem os pagos — Resend/compute Supabase/senha-vazada.

> 🩺 **Segurança — automação em 2 camadas (não depende de sessão manual):**
> 1. **DB/RLS/grants (determinística):** cron `seguranca-auditoria-cron` (semanal, servidor) roda `auditoria_seguranca()` e **e-mail só se regredir**. Cobre AUTOMATICAMENTE objetos novos de banco.
> 2. **Código (ofensiva):** Rotina agendada `Auditoria de segurança BidPro (mensal)` acorda uma sessão sozinha, roda os 3 agentes ofensivos sobre o repo e **notifica o dono** (sem MCP → não faz a parte de banco, coberta pela camada 1; não faz push automático).
> Checagem rápida a qualquer momento: `select public.auditoria_seguranca();` → `0 crítico / 0 atenção` = íntegro.
> **Auditorias ofensivas completas: 15/07/2026 (×2).** Total de correções: 15 (1ª rodada) + escalonamento por convite (CRÍTICO) + IDOR do MP (ALTO) + escala. Refazer a ofensiva quando entrarem rotas/pagamento/RLS novos (a Rotina mensal já faz isso sozinha).

## 🆕 Sessão 15–16/07/2026 — o que mudou (tudo em `main`)
> Branch de dev desta sessão: **`claude/document-inventory-validation-bstmk5`** (mesclada em `main`).

**Documentos dos lotes (cobertura):** BIASI 42%→96,5% (matrícula), CEF corrigido (1.957 editais mal gravados → matrícula direta; matrícula 100%, edital 100% sobre leilão), SODRE 55,6%→95,2% (expirados 15 lotes-zumbi), ZUK com ORDER BY+negative-cache (alcança a cauda). **PECINI PENDENTE (dono):** validar captura de docs com `PECINI_DRYRUN=1` no Actions (ver `docs/PENDENCIAS_DONO.md`).

**Saque / honorários / comissões:**
- Regra do saque: solicitações **avulsas e ilimitadas**; pagamento **só sexta** com **corte 12h** (fuso Bahia). Tela do Perfil e Comissões mostram regras + **próxima liberação**.
- **Cadastro completo obrigatório p/ sacar** (nome, CPF, telefone, PIX) — a tela aponta o que falta; **CPF é digitado 1× e reusado** (cpf-set cifra; Perfil deixa digitar quando vazio). Checagem usa **cpf_hash**.
- **Prestação de contas (admin):** "Pagar todos" (libera elegíveis da sexta) + **analítico venda→repasse** por beneficiário + nome/PIX do solicitante. **Bug corrigido:** id do lançamento é **bigint** (o PATCH validava como UUID — pagar/recusar individual falharia).
- Config em **Configurações** (honorário + comissão por plano) e **override por usuário** (Êxito por membro; **modal do afiliado** — antes era prompt). Anti-duplicidade de crédito no ledger (índice único).

**Cadastro / onboarding:**
- **Cidade obrigatória** no cadastro (filtro por região + alertas). **CPF NÃO** no cadastro grátis — só no pagamento (checkout já exige) e no saque.
- **Popup "Completar cadastro"** pós-login (`CompletarCadastroModal`): pede o que falta **um campo por vez** (cobre login Google/contas antigas). CPF saiu da exigência-base do AuthContext.
- **Role no login corrigido:** o perfil era buscado DENTRO do `onAuthStateChange` (lock) e vinha 'explorador' até dar refresh — agora deferido (setTimeout 0); reconhece o role de primeira.

**Financeiro (integridade — crítico):**
- `api/mp-admin` (transações reais) agora só conta **RECEITA real**: coleta aprovada, operação de venda, **nós como recebedor** (collector_id), líquido ≤ bruto. Antes somava pagamentos que a conta FEZ (ex.: "Anthropic") como receita.

**Scraper / qualidade de dados (regras do dono):**
- **Só imóveis do Brasil:** `salvarImoveis` descarta UF não-BR (desativei 70 lotes estrangeiros PE/PY/AR + 1 lote CEF com estado corrompido/JS).
- **Nunca gravar valor sentinela** (999999999 = falha crítica): anula (fica "sem lance"); desativei os 3 lotes SUPERBID e marquei p/ confirmar no edital.
- **Valor alto é válido** (não há teto artificial — usina de R$1bi é real).
- **Confirmação on-demand no relatório:** ao gerar relatório, `garantirValores()` confirma **avaliação + lance mínimo** no detalhe/edital (corrige GrupoLance judicial avaliação=0, etc.); o que não confirmar vira **anomalia**. *(A captura em massa foi revertida — é sob demanda.)*

**Agente que aprende + Saúde do sistema:**
- Nova tabela **`relatorio_anomalias`** + RPC: o gerador de relatório **sinaliza o que achou errado** (`avaliacao_ausente`, `cnj_vazio`, `valor_minimo_ausente`, `valor_sentinela`) → aparece na **verificação de saúde** (sentinela escala p/ ERRO).
- **Chamados de suporte:** a saúde **não fecha mais em lote** (escondia reclamação real) — só sinaliza e o botão **abre a aba Suporte** p/ ver/responder. (O `obs_interna` inexistente que fazia a ação falhar calada foi removido.) Fechei 1 chamado antigo do Igor (era erro de relatório por timeout, já corrigido).
- Aprendizados persistidos em `leiloeiro_conhecimento.observacao` (GrupoLance avaliação no detalhe; SBID9/SBID21 estrangeiros).

**Migrações novas no repo:** `biasi_matricula_backfill.sql`, `cef_editais_mal_gravados_fix.sql`, `sodre_expira_zumbis.sql`, `zuk_matricula_negative_cache.sql`, `saldo_credito_anti_duplicidade.sql`, `saque_exige_cadastro_completo.sql`, `relatorio_anomalias.sql`.

**Próximos passos sugeridos:** validar PECINI (dono); conferir na próxima geração de relatório se `garantirValores` está trazendo avaliação/mínimo (GrupoLance); backfill de UF nos lotes com UF vazia; tratar `valor_minimo_ausente`/`avaliacao_ausente` que aparecerem na saúde.

---

## 1. Projeto & infraestrutura
- **App:** BidPro Brasil — plataforma de leilões de imóveis (React + Vite → Vercel).
- **Repo GitHub:** `tarcisionogueira/tsn-app`
  - `main` → produção (deploy automático Vercel)
  - branch de desenvolvimento por sessão, sempre mesclada em `main` (a desta sessão: `claude/document-inventory-validation-bstmk5`)
- **Supabase:** projeto `zuwfiwokkdytvjixiwac` (região sa-east-1, "supabase-pink-battery"). Postgres 17.
- **Serviços:** Vercel (deploy), Asaas + Mercado Pago (pagamentos), Resend (e-mail), Daily.co (vídeo).
- **Regra de segurança crítica:** e-mail admin `tarcisioaraujo@reimob.com.br` recebe **só** notificações de sistema, **nunca** mensagens de cliente.

## 2. Estado atual do banco (JÁ APLICADO e validado)
Migrações aplicadas e conferidas nesta sessão:
- `config_honorarios` (id=1): **admin 4,5% · advogado 5% · analista 0,5%** (total 10%)
- `perfis.chave_pix`
- `casos.analista_id`, `casos.advogado_id`
- `arrematacoes`: `analista_id`, `advogado_id`, `honorarios_valor`, `honorarios_status`
- Tabela **`saldo_lancamentos`** (razão única) + RLS `saldo_self` (cada um vê o seu; admin vê tudo)
- View **`saldo_usuarios`** (security_invoker): `saldo_disponivel`, `total_sacado`, `saque_pendente`
- Segurança aplicada: 3 views `SECURITY DEFINER` → security_invoker; RLS em config_honorarios/slots_reuniao/disponibilidade_analista; search_path pinado em 14 funções.

Arquivos de migração no repo: `supabase/migrations/add_saque_honorarios_base.sql`, `add_seguranca_views_rls.sql`, `add_leiloeiros_fontes.sql`.

## 3. Feature SAQUE + HONORÁRIOS (arquitetura — ledger único)
**Saldo = soma de `saldo_lancamentos` (status ≠ 'cancelado').** Créditos (+): comissão de venda, honorário de êxito. Débito (−): saque.

Regras do fluxo:
- **Honorário de êxito = 10% do valor de arrematação**, dividido admin 4,5% / advogado 5% / analista 0,5%.
- **Admin absorve a parte da equipe ainda não sorteada** (total sempre 10%).
- **Sorteio (entre ativos):** analista → na **1ª reunião** (`api/agendar-reuniao.js`); advogado → quando o **analista encaminha ao jurídico** (`src/pages/Caso.jsx` `encaminharJuridico`). Só o analista encaminha, nunca o cliente. Admin é fixo.
- **Arrematação** herda a equipe do caso e distribui no status `finalizado` (idempotente via `honorarios_status`) — `api/arrematacoes.js`.
- **Saque** (`api/saque.js`): solicita qualquer dia (reserva no ledger, status 'solicitado'); admin paga **só sexta** (`status='sacado'`) ou recusa. Pagamento manual hoje; deixar pronto para automatizar (cron) depois — no intervalo o dinheiro rende na conta MP.
- **Privacidade:** cada usuário vê só o próprio saldo; admin vê tudo (Admin → Prestação de contas).
- **Comissão fixa de indicação** (sistema/curso/ebook): consultor, analista E advogado podem indicar → credita o ledger (`api/_webhook-core.js`).

Telas: `Perfil.jsx` (saldo + solicitar saque), `Comissoes.jsx` (extrato), `Admin.jsx` aba "Prestação de contas".

## 4. PENDENTE / VALIDAR (fazer na nova sessão com MCP)
1. **Auditoria completa dos fluxos** (com Supabase conectado) — do antes do login ao saque.
2. **Destravar cadastro:** o erro "email rate limit exceeded" é do **Supabase Auth**. Resolver: desligar "Confirm email" (Auth → Providers → Email) **ou** configurar **Resend como SMTP** (Auth → SMTP) — recomendado.
3. **Cadastrar 1 analista + 1 advogado** (ativos, com `chave_pix`) via convite de equipe (Admin → Equipe → Convidar). Sem eles, o admin recebe os 10% inteiros.
4. **Teste ponta a ponta:** caso → agendar reunião (sorteia analista) → encaminhar jurídico (sorteia advogado) → registrar arrematação + finalizar (credita 3 honorários) → solicitar saque → Admin paga (sexta) → conferir `saldo_usuarios` e `saldo_lancamentos`.
5. **Limpeza de teste:** `UPDATE perfis SET ativo=false WHERE cpf IN (...)` e `DELETE FROM saldo_lancamentos WHERE origem_id='TESTE'`. (perfis NÃO tem coluna email — usar cpf/nome.)

## 5. Deferidos (próximas fases)
- **IA lê boleto do sinal + comprovante** anexados na arrematação para aprender o fluxo de leilões.
- **Saque automático** às sextas (cron) após validar o fluxo manual.
- **Privacidade dos percentuais:** `config_honorarios` é legível por logados (um profissional pode *calcular* a fatia do outro). Os valores reais já estão protegidos por RLS. Avaliar restringir os percentuais a admin.
- **Leiloeiros via proxy** (ScraperAPI ou Bright Data) — Fase 1 pronta (`scripts/lib/scraper-core.mjs`, `scripts/scraper-leiloeiros.mjs`, registro `leiloeiros_fontes`). Falta plugar a chave do proxy. ~US$ 12–32/mês.

## 6. Notas técnicas
- Scraper CEF: `scripts/scraper.js` (GitHub Actions, 6h). Coluna `financiamento` (Sim/Não) no índice 8 do CSV — corrigido.
- Proxies de imagem: `api/img-caixa.js` (CEF, padrão `/fotos/F{id}.jpg`), `api/img-proxy.js` (whitelist em `api/_allowed-hosts.js`).
- Senha forte (8+ maiúscula/minúscula/número/especial) validada no front; leaked-password do Supabase exige plano Pro.
- Commits desta sessão: prefixo de fixes/feat, autor `noreply@anthropic.com`, em `main` e na branch de dev.
</content>
