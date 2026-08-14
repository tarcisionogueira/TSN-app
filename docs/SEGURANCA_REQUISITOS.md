# 🔐 Segurança — requisitos atendidos, lacunas e resposta a incidente

> **Intenção do dono (13/08):** *"não são os certificados, mas atender a todos os requisitos deles
> para cobrir qualquer eventualidade."* Este documento é o mapa disso: o que os controles de
> ISO 27001 / SOC 2 exigem **na substância**, o que já existe, o que falta e quem resolve.
> Não é candidatura a certificado — é a lista de exigências, tratada pelo mérito.

---

## 0. A premissa que muda o mapa

**Não há sistema operacional sob nossa responsabilidade.** A arquitetura é Vercel (serverless) +
Supabase (Postgres gerenciado). Não existe SSH, kernel, patching de host, firewall de sistema ou
hardening de SO do nosso lado — isso é da Vercel e da Supabase, ambas com SOC 2 Tipo II e
ISO 27001 vigentes.

Isso **elimina** uma classe inteira de risco (CVE de kernel, porta aberta, servidor esquecido sem
patch) e **cria** outra: dependência de terceiro. O controle que nos cabe aí não é técnico, é de
fornecedor — saber o que eles garantem e o que acontece se falharem (§4).

---

## 1. Estado medido (13/08, Supabase Security Advisor + auditor próprio)

| Indicador | Valor |
|---|---|
| Advisor — nível **ERROR** | **0** |
| `auditoria_seguranca()` (auditor próprio, semanal) | **0 crítico / 0 atenção** |
| Funções próprias sem `search_path` fixo | **0** (eram 21, corrigidas em 13/08) |
| Tabelas com PII sem RLS | **0** |
| Advisor — WARN | 95 · **decomposto abaixo** |

**Os 95 WARN, honestamente decompostos** (contagem bruta engana):

- **57 · `authenticated_security_definer_function_executable`** — função privilegiada chamável por
  usuário logado. É como a arquitetura funciona: a regra de negócio vive em RPC, e o RLS protege
  a tabela. Não é achado, é o desenho.
- **21 · `function_search_path_mutable`** — **corrigido em 13/08.** Ressalva de honestidade: eu
  havia classificado isso como "vetor clássico de escalação de privilégio", e **exagerei** —
  medido depois, **nenhuma das 21 era SECURITY DEFINER**. Sem DEFINER a função roda com o
  privilégio de quem chama, então não há escalação; o risco real era sequestro de RESOLUÇÃO
  (a função ler o objeto errado). Corrigir foi certo e barato; a gravidade era menor.
- **15 · `anon_security_definer_function_executable`** — auditadas uma a uma em 13/08:
  5 são funções de GATILHO (o detector as lista, mas gatilho não se chama direto);
  5 são deliberadamente públicas por TOKEN (`get_contrato_por_token`, `get_convite_equipe_info`
  e afins — quem assina contrato ou aceita convite não tem conta, e o token é a credencial);
  3 devolvem o papel do PRÓPRIO chamador (`is_admin`, `is_equipe`, `app_role` — anon recebe anon);
  2 foram abertas e lidas linha a linha: `obter_arquivo_ebook` só devolve arquivo pago com compra
  ativa e `registrar_imovel_visto` sai imediatamente se `auth.uid()` for nulo. **Nada a fazer.**
- **2 · `extension_in_public`** — `cube` e `earthdistance` no schema `public`. Mover exige recriar
  os índices geoespaciais do Índice; risco de mudança maior que o do achado. **Aceito, com registro.**

**Leitura:** o número 95 não é uma fila de 95 problemas. São ~3 problemas reais, e os três foram
resolvidos ou conscientemente aceitos.

---

## 2. Requisitos ISO 27001 / SOC 2 — mapa de cobertura

Legenda: ✅ atendido · 🟡 parcial · 🔴 ausente · N/A não se aplica à arquitetura.

| # | Requisito (o que o controle EXIGE na substância) | Status | Como está coberto / o que falta |
|---|---|---|---|
| 1 | **Controle de acesso lógico** — cada pessoa só alcança o que precisa | ✅ | RLS em todas as tabelas com PII; papéis (`admin`/`analista`/`advogado`/cliente/parceiro); `auditoria_seguranca()` acusa objeto novo sem RLS |
| 2 | **Autenticação forte de administradores** | 🟡 | Supabase Auth com senha forte obrigatória. **MFA nas contas de infra (Supabase/Vercel/GitHub) precisa ser confirmado** — ver §5 |
| 3 | **Criptografia em trânsito** | ✅ | HTTPS obrigatório; HSTS; sem endpoint em texto claro |
| 4 | **Criptografia em repouso** | ✅ | Herdada de Supabase/Vercel (AES-256 em disco) |
| 5 | **Gestão de segredos** | ✅ | Nenhum segredo em bundle de front; variáveis no painel Vercel; repositório é PÚBLICO e a regra "nunca escrever VALOR de segredo" está no CLAUDE.md e já foi exercida (rotação do `RESEND_WEBHOOK_SECRET`, 03/08) |
| 6 | **Rotação de credenciais** | 🔴 | Sem política escrita nem calendário. **Ver §5** |
| 7 | **Registro de auditoria (logs)** | ✅ | `atividade_log`, `eventos_atividade`, `erros_cliente` (com stack, desde 13/08), `seguranca_auditoria`, Runtime Logs da Vercel |
| 8 | **Detecção contínua de vulnerabilidade** | ✅ **acima da média** | Auditor no banco (cron semanal, e-mail só se regredir) + 3 agentes ofensivos mensais + 3 travas determinísticas no CI/prebuild |
| 9 | **Teste de intrusão independente** | 🔴 | Nunca houve pentest externo. **É a maior lacuna técnica** — ver §5 |
| 10 | **Gestão de mudança** | ✅ | Tudo por git; CI obrigatório (`verificar:padroes`, `:schema`, `:sintaxe`); deploy automático com rastro de commit |
| 11 | **Backup e recuperação** | 🟡 | Backup diário da Supabase é padrão do plano. **PITR e teste de restauração precisam ser confirmados** — ver §5 |
| 12 | **Continuidade / RTO-RPO declarados** | 🔴 | Nenhum objetivo formal de tempo de recuperação |
| 13 | **Resposta a incidente** | ✅ **novo, §3** | Plano escrito abaixo, com severidade, prazos e o gatilho da ANPD |
| 14 | **Privacidade / LGPD** | 🟡 | Base legal e aceites com IP e versão dos termos (trilha anti-chargeback); exclusão de conta; retenção automática de documentos. **Falta:** encarregado (DPO) formalmente nomeado e publicado |
| 15 | **Segurança de fornecedor** | 🟡 | Fornecedores são de primeira linha e certificados. **Falta:** o registro de §4 mantido e revisto |
| 16 | **Classificação da informação** | 🟡 | Na prática existe (documento de KYC em bucket privado, PII com RLS). Não está escrita |
| 17 | **Hardening de SO / rede** | N/A | Sem SO nosso (§0) |
| 18 | **Conscientização da equipe** | 🔴 | Sem treinamento formal. Baixa prioridade enquanto a equipe é pequena, mas é requisito |

---

## 3. PLANO DE RESPOSTA A INCIDENTE

> Requisito 13. Sem isto, um incidente vira improviso — e a LGPD tem prazo correndo.

### 3.1 Classificação

| Severidade | Definição | Exemplos |
|---|---|---|
| **S1 — Crítico** | Dado pessoal exposto/exfiltrado, ou dinheiro em risco | Falha de RLS expondo CPF; chave de serviço vazada; fraude no checkout |
| **S2 — Alto** | Indisponibilidade total ou corrupção de dado do cliente | Site fora; relatórios emitidos com dado de outro cliente |
| **S3 — Médio** | Função relevante quebrada, sem exposição de dado | Geração de relatório em 500; coleta parada |
| **S4 — Baixo** | Defeito localizado, com contorno | Layout quebrado; erro isolado em `erros_cliente` |

### 3.2 Passos (S1/S2)

1. **CONTER antes de entender.** Rotacionar a credencial suspeita; se necessário, `REVOKE` do papel
   afetado ou desligar a rota. Perder função é melhor que continuar vazando.
2. **PRESERVAR a evidência.** Antes de corrigir: salvar as linhas relevantes de `erros_cliente`,
   `atividade_log`, `seguranca_auditoria` e os Runtime Logs da Vercel (que expiram).
   Correção apaga rastro — o rastro é o que responde "quantos foram afetados".
3. **MEDIR o alcance.** Quantos usuários, quais campos, qual janela de tempo. Sem número, não há
   como decidir sobre notificação nem como comunicar sem exagerar ou minimizar.
4. **CORRIGIR na raiz** e provar a correção com consulta, não com leitura de código.
5. **NOTIFICAR** (§3.3).
6. **REGISTRAR** no HANDOFF: o que houve, alcance medido, causa-raiz, correção e **a trava** que
   impede a volta. Incidente sem trava é incidente agendado.

### 3.3 Notificação — os prazos que correm

- **ANPD + titulares:** a LGPD (art. 48) exige comunicar incidente que possa acarretar **risco ou
  dano relevante**. A Resolução CD/ANPD nº 15/2024 fixa **3 dias úteis contados do conhecimento**.
  O relógio começa quando se SABE, não quando se termina a investigação — comunicar parcial e
  complementar depois é o previsto, e é melhor que perder o prazo.
- **Titulares afetados:** linguagem simples, o que foi exposto, o que já foi feito, o que a pessoa
  deve fazer.
- **Quem decide:** o dono. Este documento não delega a decisão de notificar.

### 3.4 Contatos e canais

- Responsável pela decisão: **o dono** (`tarcisioaraujo@reimob.com.br`).
- Encarregado LGPD (DPO): **a nomear** — requisito 14.
- Canal público de privacidade: `privacidade@bidprobrasil.com.br` ⚠️ **depende do MX do domínio,
  hoje pendente** (item C das pendências do dono). Um canal de privacidade publicado que não
  recebe é, por si só, um problema de conformidade.

---

## 4. Registro de fornecedores críticos

| Fornecedor | O que guarda/faz | Se cair | Certificação |
|---|---|---|---|
| **Supabase** | Banco, Auth, Storage (docs de KYC) | Sistema inteiro para | SOC 2 Tipo II, ISO 27001 |
| **Vercel** | Front + todas as funções de API | Sistema inteiro para | SOC 2 Tipo II, ISO 27001 |
| **Mercado Pago** | Pagamento (principal) | Checkout cai no Asaas | PCI-DSS |
| **Asaas** | Pagamento (backup) | Só o backup | PCI-DSS |
| **Resend** | E-mail transacional | Sem e-mail; app segue | SOC 2 |
| **Anthropic / Google** | Geração dos relatórios | Sem relatório novo; acervo intacto | SOC 2 |
| **Bright Data** | Coleta em fontes protegidas | Fontes pagas param | — |
| **Daily.co** | Vídeo das reuniões | Sem reunião por vídeo | SOC 2 |

**Revisar quando:** entrar fornecedor novo, ou anualmente.

---

## 5. O QUE DEPENDE DO DONO — com o passo exato

| # | Item | Por quê | Como fazer |
|---|---|---|---|
| 1 | **MFA obrigatório** em Supabase, Vercel e GitHub | Uma senha de admin comprometida entrega o banco inteiro. É o controle de maior retorno da lista | Supabase: Account → Security → Enable MFA. Vercel: Settings → Authentication. GitHub: Settings → Password and authentication |
| 2 | **Confirmar PITR** no Supabase | Backup diário perde até 24h. PITR recupera ao segundo — e é o que salva de um `DELETE` errado | Dashboard → Database → Backups. Se não estiver no plano, avaliar o custo contra o risco |
| 3 | **Testar uma restauração** | Backup nunca testado não é backup, é esperança | Restaurar num projeto novo e conferir uma tabela. Uma vez por ano basta |
| 4 | **Pentest externo com laudo** | Requisito 9, a maior lacuna técnica. É também o que cliente corporativo pede | Contratar; escopo mínimo: auth, RLS, webhooks de pagamento, upload de documento |
| 5 | **Nomear e publicar o Encarregado (DPO)** | Requisito 14. A LGPD exige identificação pública | Definir a pessoa e publicar na Política de Privacidade |
| 6 | **Rotação de credenciais** | Requisito 6 | Calendário anual, e SEMPRE após saída de pessoa com acesso |
| 7 | **MX do domínio** | Sem ele, `privacidade@` e `suporte@` não recebem — e isso é lacuna de conformidade, não só de produto | Já é o item C das pendências |

---

## 6. Nota de postura — e como ela se move

**72 / 100** em 13/08, antes deste trabalho. Decomposta:

| Eixo | Peso | Antes | Depois de 13/08 |
|---|---|---|---|
| Segurança de aplicação | 30 | 26 | **26** |
| Detecção e auditoria contínua | 20 | 18 | **18** |
| Hardening de banco | 20 | 13 | **18** (21 `search_path` fechados + 15 anon auditadas) |
| Infra / SO | 15 | 13 | **13** |
| Governança | 15 | 2 | **5** (plano de incidente + registro de fornecedores) |
| **Total** | 100 | **72** | **80** |

**O teto sem ação do dono é ~85.** Os pontos que faltam estão quase todos no §5, e o pentest
(item 4) sozinho vale ~6. Não é falta de rigor técnico: é que *governança* se comprova com
documento, teste e terceiro — três coisas que código não produz sozinho.
