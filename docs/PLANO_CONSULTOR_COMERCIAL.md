# Plano — Evolução do Consultor Comercial (Consórcio + Home Equity)

> Pedido do dono (21/08): o convite de consultor passa a habilitar um PARCEIRO COMERCIAL
> que recebe as aplicações de consórcio e home equity e faz o atendimento até o fechamento.
> Sem integração com a financeira → o rastreio interno é a única prova na negociação.
> Status: **PLANO PARA APROVAÇÃO** — nada aqui foi implementado ainda.

## 1. Princípios (do pedido, viram regra_negocio)

1. **Role não muda.** O usuário mantém o plano e as permissões que já tem (explorador,
   investidor pro…). "Ser consultor comercial" é CAPACIDADE aditiva — e a infra já existe:
   `perfis.vendedor_tipo` (hoje 'consultor'|'afiliado'), concedida por
   `convites_vendedor` + `api/ativar-vendedor.js`, exatamente sem tocar o role.
2. **Minimização de dados.** O consultor vê dos leads SOMENTE nome, telefone e e-mail
   (+ produto/origem/status/datas). Nunca `respostas` da triagem, nunca dados de conta.
3. **Trilha imutável.** Todo toque no lead vira evento append-only com autor e timestamp
   do servidor. É o "quem trouxe, quem atendeu, quando" que protege na negociação sem
   integração com a financeira.
4. **Admin vê tudo.** Cada lead, cada evento, cada finalização — na visão do admin.

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
   `id, lead_id, autor_id, autor_papel ('consultor'|'admin'|'sistema'), tipo
   ('atribuido'|'contato'|'feedback'|'finalizado'|'reaberto'), comentario, criado_em default now()`.
   RLS: INSERT para o consultor dono do lead e admin; SELECT consultor (só dos seus) e
   admin; **sem UPDATE/DELETE para ninguém além do service** — trilha não se edita.
2. **`sdr_leads`** ganha: `finalizado_em`, `resultado` ('ganho'|'perdido'|'sem_contato'),
   e os status passam a ciclo fechado: `novo → atribuido → em_atendimento → finalizado`.
   (Colunas de data seguem o padrão da tabela: `criado_em` — forma #6.)
3. **`convites_vendedor.tipo`** ganha o valor `'consultor_comercial'` (ou flag própria) —
   ativação seta `perfis.vendedor_tipo='consultor'` E marca a capacidade comercial.
4. **RPCs (SECURITY DEFINER, com checagem interna de vendedor_tipo/admin):**
   - `comercial_meus_leads()` → APENAS id, nome, telefone, email, produto, status,
     criado_em, ultimo_evento — dos leads com `consultor_id = auth.uid()`.
   - `comercial_registrar_evento(lead_id, tipo, comentario)` → valida dono, grava evento,
     atualiza status; `finalizado` EXIGE comentario não-vazio + resultado.
   - `admin_comercial_visao()` → tudo + trilha, só admin.
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
  MEUS leads (nome/telefone/email/produto/status/dias parado) + botão WhatsApp; botão
  **Acompanhamento** (linha do tempo + adicionar feedback) e **Finalizar** (resultado +
  comentário obrigatório). Nada de dados além do mínimo.
- **Atendimento (reuso, escopo novo):** o consultor comercial passa a ver SOMENTE os
  chamados dos leads dele (o chamado já nasce no api/duvida; falta vincular chamado↔lead
  e abrir o escopo por esse vínculo). Admin segue vendo tudo.
- **Admin › Comercial:** todos os leads, dono, trilha completa, atribuição manual,
  exportação CSV (a "prova" para a negociação com a financeira).
- **Consultor.jsx:** ganha um card "Leads de alavancagem" apontando para /comercial (a
  tela atual segue sendo o hub de venda de planos/links).

## 6. Rastreio anti-"passado para trás" (sem integração com a financeira)

- Evento com `criado_em` do SERVIDOR (default now(), sem aceitar data do cliente).
- Trilha append-only (RLS nega UPDATE/DELETE) — nem consultor nem admin reescrevem o passado.
- `comissoes` registra o combinado por lead finalizado ganho (origem='alavancagem',
  referencia=lead_id) — mesmo sem pagamento automático, o VALOR acordado fica datado.
- Invariantes novos em `qa_invariantes()`: `lead_alavancagem_sem_dono_3d`,
  `lead_atribuido_sem_contato_2d`, `lead_finalizado_sem_comentario` (este deve ser
  estruturalmente impossível pela RPC — o invariante vigia a porta dos fundos).
- `regra_negocio`: "consultor comercial vê só nome/telefone/email" (aplicada_por:
  comercial_meus_leads) e "finalizar exige comentário" (aplicada_por:
  comercial_registrar_evento) — a auditoria 2b passa a vigiar as duas.

## 7. Fases (ordem de ataque)

| Fase | Entrega | Tamanho |
|---|---|---|
| F1 | Migrações (eventos + colunas + RPCs + RLS) e regra_negocio | 1 sessão |
| F2 | Tela /comercial completa (lista + acompanhamento + finalizar) | 1 sessão |
| F3 | Atribuição: ?ref no link + stamped no api/duvida + atribuição manual no Admin | ½ sessão |
| F4 | Atendimento com escopo do consultor (vínculo chamado↔lead) | ½ sessão |
| F5 | Admin › Comercial (visão total + CSV) + invariantes qa + convite no Equipe | 1 sessão |

## 8. Decisões em aberto (dono)

1. **Comissão:** % ou valor fixo por fechamento de consórcio/home equity? Registrar em
   `regra_negocio` + `comissoes` desde o dia 1?
2. **Resultado "perdido" exige motivo estruturado** (lista: sem interesse / não qualificou
   / fechou direto com a financeira / outro)? — recomendo SIM: é o dado que denuncia se a
   financeira está "perdendo" leads que depois fecham por fora.
3. **SLA de contato** (o invariante de 2 dias parado): 2 dias úteis está bom?
4. O consultor comercial também deve ver leads de alavancagem de clientes que ELE indicou
   no passado (carteira), ou só os atribuídos?
