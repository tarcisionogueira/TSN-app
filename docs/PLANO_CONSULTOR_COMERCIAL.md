# Plano — Evolução do Consultor Comercial (Consórcio + Home Equity)

> Pedido do dono (21/08): o convite de consultor passa a habilitar um PARCEIRO COMERCIAL
> que recebe as aplicações de consórcio e home equity e faz o atendimento até o fechamento.
> Sem integração com a financeira → o rastreio interno é a única prova na negociação.
> Status: **F1 CONCLUÍDA (21/08)** — migrações aplicadas em produção e no repo
> (supabase/migrations/consultor_comercial_fase1.sql): trilha sdr_lead_eventos,
> sdr_lead_nps, colunas de ciclo, RPCs comercial_* lendo as regras de regra_negocio
> via public.regra() (auditoria 2b: 0 crítico; segurança: 0/0), CHECK de status de
> sdr_leads ampliado (o antigo era só vocabulário SDR e recusava o ciclo comercial —
> o teste de mesa pegou). Ciclo validado com rollback: contato oculto → Receber
> revela+registra → feedback na trilha. Concluídas F2 (tela /comercial) e F3 (atribuição ?ref + Admin). Concluída F4 (Atendimento com escopo). Próximas: **F5 (NPS)** e F6.

## 1. Princípios (do pedido, viram regra_negocio)

1. **Escopo fechado (confirmado pelo dono, 21/08):** o consultor comercial vê
   EXCLUSIVAMENTE leads com origem `alavancagem_consorcio` e `alavancagem_home_equity`
   que estejam atribuídos a ele (`consultor_id = auth.uid()`). Nenhum outro lead, cliente
   ou dado da plataforma — o filtro de origem entra DENTRO da RPC, não fica a cargo da tela.
2. **Role não muda.** O usuário mantém o plano e as permissões que já tem (explorador,
   investidor pro…). "Ser consultor comercial" é CAPACIDADE aditiva — e a infra já existe:
   `perfis.vendedor_tipo` (hoje 'consultor'|'afiliado'), concedida por
   `convites_vendedor` + `api/ativar-vendedor.js`, exatamente sem tocar o role.
3. **Contato NÃO fica exposto na lista (melhoria do dono, 21/08).** A lista mostra só
   nome, produto e data. Telefone e e-mail só aparecem depois do botão **"Receber
   cliente"** — que registra o evento `recebido` (início do atendimento) na trilha. O
   ato de VER o contato é, ele próprio, um registro datado: ninguém enxerga contato de
   lead que não assumiu, e a LGPD ganha um log de acesso de graça.
4. **Trilha imutável.** Todo toque no lead vira evento append-only com autor e timestamp
   do servidor. É o "quem trouxe, quem atendeu, quando" que protege na negociação sem
   integração com a financeira.
5. **O cliente fecha o circuito (melhoria do dono, 21/08):** 15 dias após o consultor
   confirmar o atendimento, o SISTEMA pergunta ao cliente (NPS por e-mail): conseguiu
   contratar? como foi o atendimento? A resposta do cliente é a contraprova independente
   do relato do consultor — é ela que denuncia o "perdido" que na verdade fechou por fora.
6. **Admin vê tudo.** Cada lead, cada evento, cada finalização, cada NPS — na visão do admin.

## 2. O que JÁ existe (aproveitamento máximo — quase tudo tem fundação)

| Peça | Onde | Estado |
|---|---|---|
| Aplicação do cliente | `Alavancagem.jsx` → `/api/duvida` | grava `sdr_leads` (origem `alavancagem_home_equity`/`_consorcio`) + abre **chamado** no Atendimento |
| Atribuição no lead | `sdr_leads.consultor_id` | coluna JÁ existe (hoje sempre null) |
| Capacidade sem trocar role | `perfis.vendedor_tipo` + `convites_vendedor` + `api/ativar-vendedor` | funciona hoje p/ vendedor; falta o sabor "consultor comercial" habilitar as telas novas |
| Tela do parceiro | `Consultor.jsx` (/consultor) | já lê `sdr_leads` por `consultor_id`, carteira, comissões, links |
| Atendimento | `Atendimento.jsx` + `chamados` | o chamado do lead JÁ nasce lá (via api/duvida) |
| Comissões | `comissoes` (beneficiario_id, origem, status) | serve para registrar o combinado por lead |
| Regras auditáveis | `regra_negocio` + `auditoria_regras_negocio()` | regras novas entram aqui com `aplicada_por` |
| Segurança automática | `auditoria_seguranca()` | tabela nova com PII sem RLS é acusada sozinha |

**⚠️ Achado de RLS que o plano NÃO pode repetir:** a política `leads_equipe` dá ao *role*
`consultor` acesso `*` (todas as linhas, todas as colunas) de `sdr_leads`. O consultor
comercial novo NÃO passa por ela (role continua o do plano) — e é bom que não passe: o
acesso dele será por **RPC com colunas mínimas**, nunca por SELECT direto na tabela.

## 3. Modelo de dados (migrações)

1. **`sdr_lead_eventos`** (append-only — a espinha do rastreio):
   `id, lead_id, autor_id, autor_papel ('consultor'|'admin'|'sistema'|'cliente'), tipo
   ('atribuido'|'recebido'|'contato'|'feedback'|'atendimento_confirmado'|'finalizado'|
   'reaberto'|'nps_enviado'|'nps_respondido'), comentario, criado_em default now()`.
   RLS: INSERT para o consultor dono do lead e admin; SELECT consultor (só dos seus) e
   admin; **sem UPDATE/DELETE para ninguém além do service** — trilha não se edita.
2. **`sdr_leads`** ganha: `recebido_em`, `finalizado_em`, `resultado`
   ('ganho'|'perdido'|'sem_contato'), e os status passam a ciclo fechado:
   `novo → atribuido → em_atendimento (via Receber) → finalizado`.
   (Colunas de data seguem o padrão da tabela: `criado_em` — forma #6.)
3. **`sdr_lead_nps`** (a contraprova do cliente): `id, lead_id (unique), token (para o
   link do e-mail, sem login), enviado_em, respondido_em, contratou (bool), nota (0-10),
   comentario`. Preenchida SÓ pela rota pública do token (uma resposta por lead) e lida
   por admin; o consultor vê apenas nota/contratou do próprio lead DEPOIS de respondido.
4. **`convites_vendedor.tipo`** ganha o valor `'consultor_comercial'` (ou flag própria) —
   ativação seta `perfis.vendedor_tipo='consultor'` E marca a capacidade comercial.
5. **RPCs (SECURITY DEFINER, com checagem interna de vendedor_tipo/admin):**
   - `comercial_meus_leads()` → **SEM contato**: id, nome, produto, status, criado_em,
     ultimo_evento — dos leads `alavancagem_%` com `consultor_id = auth.uid()`. O filtro
     de origem mora AQUI (princípio 1).
   - `comercial_receber_lead(lead_id)` → valida dono + status, grava evento `recebido`,
     seta `recebido_em`/status e SÓ ENTÃO devolve telefone e e-mail (princípio 3 — a
     revelação do contato é o registro).
   - `comercial_registrar_evento(lead_id, tipo, comentario)` → valida dono, grava evento,
     atualiza status; `finalizado` EXIGE comentario não-vazio + resultado; exige que o
     lead tenha sido RECEBIDO antes (não existe finalizar o que nunca se atendeu).
   - `admin_comercial_visao()` → tudo + trilha + NPS, só admin.
   Regra da casa: migração no repo no MESMO commit (forma #7/#7b).

## 4. Fluxo de atribuição (quem é o dono do lead)

1. **Pelo link do consultor:** o link de alavancagem ganha `?ref=<codigo do consultor>`
   (mesmos `links_convite`/código de indicação já existentes). O front guarda o ref (como
   já faz com mkt_*/gclid no cadastro) e o `/api/duvida` grava `consultor_id` resolvendo o
   código NO SERVIDOR (nunca aceita user_id cru do corpo — mesmo desenho do user_id atual).
2. **Manual pelo admin:** seção no Admin (aba Comercial) lista leads de alavancagem sem
   dono e atribui → evento `atribuido` com autor=admin.
3. **Conflito (ref de A, admin atribui a B):** o evento guarda os dois — a trilha decide a
   discussão de comissão, que é justamente o ponto.

## 5. Telas

- **/comercial (nova, enxuta):** gate = `vendedor_tipo='consultor'` (ou admin). Lista dos
  MEUS leads mostrando só **nome, produto, status e dias parado** — sem contato à vista.
  O card novo tem UM botão: **"Receber cliente"** → confirma o início do atendimento,
  gera o evento `recebido` e só então o card abre telefone/e-mail + botão WhatsApp.
  Lead recebido ganha **Acompanhamento** (linha do tempo + adicionar feedback),
  **Atendimento realizado** (dispara a janela dos 15 dias do NPS) e **Finalizar**
  (resultado + comentário obrigatório).
- **Atendimento (reuso, escopo novo):** o consultor comercial passa a ver SOMENTE os
  chamados dos leads dele (o chamado já nasce no api/duvida; falta vincular chamado↔lead
  e abrir o escopo por esse vínculo). Admin segue vendo tudo.
- **Admin › Comercial:** todos os leads, dono, trilha completa, atribuição manual,
  exportação CSV (a "prova" para a negociação com a financeira).
- **Consultor.jsx:** ganha um card "Leads de alavancagem" apontando para /comercial (a
  tela atual segue sendo o hub de venda de planos/links).

## 6. Rastreio anti-"passado para trás" (sem integração com a financeira)

O rastreio agora tem TRÊS testemunhas independentes, e é o cruzamento delas que protege:
o **consultor** (eventos que ele registra), o **sistema** (timestamps do servidor,
revelação de contato logada) e o **cliente** (NPS) — nenhuma delas sozinha fecha a conta.

- Evento com `criado_em` do SERVIDOR (default now(), sem aceitar data do cliente).
- Trilha append-only (RLS nega UPDATE/DELETE) — nem consultor nem admin reescrevem o passado.
- **Contato só via "Receber cliente"**: quem viu o telefone de quem, e quando, está na
  trilha — não existe acesso a contato sem registro.
- **NPS do cliente (15 dias após `atendimento_confirmado`):** cron diário (infra de cron
  existente) acha leads confirmados há ≥15 dias sem NPS enviado → e-mail via Resend com
  link tokenizado (sem login): *"Você conseguiu contratar? (sim/não) · Nota do
  atendimento (0-10) · Comentário"*. Uma resposta por lead. **Os cruzamentos que
  denunciam:** consultor marcou `perdido` × cliente respondeu `contratou=sim` = provável
  fechamento por fora (alerta ao admin); `ganho` × `contratou=não` = registro inflado;
  nota média por consultor = qualidade do atendimento que o dono enxerga sem depender de
  relato.
- `comissoes` registra o combinado por lead finalizado ganho (origem='alavancagem',
  referencia=lead_id) — mesmo sem pagamento automático, o VALOR acordado fica datado.
- Invariantes novos em `qa_invariantes()`: `lead_alavancagem_sem_dono_3d`,
  `lead_recebido_sem_contato_2d`, `lead_finalizado_sem_comentario` (estruturalmente
  impossível pela RPC — o invariante vigia a porta dos fundos), `nps_contradiz_resultado`
  (perdido×contratou / ganho×não-contratou) e `nps_vencido_nao_enviado` (cron parado).
- `regra_negocio`: "consultor comercial vê apenas leads de alavancagem atribuídos a ele"
  (aplicada_por: comercial_meus_leads), "contato só após Receber" (aplicada_por:
  comercial_receber_lead), "finalizar exige comentário" (aplicada_por:
  comercial_registrar_evento) e "NPS ao cliente 15d após atendimento confirmado"
  (aplicada_por: cron do NPS) — a auditoria 2b passa a vigiar as quatro.

## 7. Fases (ordem de ataque)

| Fase | Entrega | Tamanho |
|---|---|---|
| F1 ✅ | Migrações (eventos + NPS + colunas + RPCs + RLS) e regra_negocio — concluída 21/08 | feita |
| F2 ✅ | Tela /comercial completa (lista sem contato + Receber cliente + acompanhamento + atendimento realizado + finalizar) — concluída 21/08 | feita |
| F3 ✅ | Atribuição: ?ref no link + stamped no api/duvida + atribuição manual no Admin — concluída 21/08 | feita |
| F4 ✅ | Atendimento com escopo do consultor (vínculo chamado↔lead) — concluída 21/08 | feita |
| F5 | NPS: rota pública tokenizada + cron 15d + e-mail Resend + invariantes de contradição | 1 sessão |
| F6 | Admin › Comercial (visão total + trilha + NPS + CSV) + invariantes qa + convite no Equipe | 1 sessão |

## 8. Decisões já tomadas pelo dono (21/08)

- Escopo: SOMENTE aplicações de consórcio e home equity. ✔
- Contato não exposto na lista; botão "Receber cliente" revela e registra. ✔
- NPS ao cliente 15 dias após a confirmação de atendimento, perguntando se contratou e
  como foi o atendimento. ✔

## 9. Decisões em aberto (dono)

1. **Comissão:** % ou valor fixo por fechamento de consórcio/home equity? Registrar em
   `regra_negocio` + `comissoes` desde o dia 1?
2. **Resultado "perdido" exige motivo estruturado** (lista: sem interesse / não qualificou
   / fechou direto com a financeira / outro)? — recomendo SIM: cruza com o NPS para
   denunciar lead "perdido" que o cliente diz ter contratado.
3. **SLA de contato** (o invariante de lead recebido parado): 2 dias úteis está bom?
4. O consultor comercial também deve ver leads de alavancagem de clientes que ELE indicou
   no passado (carteira), ou só os atribuídos?
