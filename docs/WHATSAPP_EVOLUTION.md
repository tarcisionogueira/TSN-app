# WhatsApp pela Evolution API (QR code) — como ligar

**Situação (22/11):** o número (11) 96407-9726 está no app WhatsApp Business, mas o chip está inativo
na operadora. Enquanto a portabilidade não sai, o número entra pela **Evolution API** (conexão não
oficial por QR code). Depois da portabilidade e da Verificação da Meta, o mesmo código troca para a
**Cloud API oficial** só mudando `WA_CANAL=oficial` (as envs da oficial estão em `docs/ENVS_VERCEL.md`).

## O que já está pronto no código

| Peça | Arquivo | O que faz |
|---|---|---|
| Porta de entrada | `api/whatsapp-evolution-webhook.js` | Recebe as mensagens da Evolution e grava em `wa_conversas`/`wa_mensagens` |
| Envio | `api/_whatsapp-envio.js` | Manda pela Evolution ou pela oficial, conforme `WA_CANAL` |
| IA (SDR) | `api/whatsapp-responder.js` + `api/chat-suporte.js` | Responde, qualifica o perfil, oferece Investidor Pro / Veículos / Combo / Assessoria / e-book, escala para humano |
| Tela de Atendimento | trigger `wa_espelhar_no_chamado` + `src/pages/Atendimento.jsx` | Toda conversa vira chamado canal "WhatsApp"; a resposta da equipe na tela sai pelo WhatsApp (`api/atendimento-whatsapp.js`) |
| Fila ativa | `api/whatsapp-disparos-cron.js` + tabelas `wa_disparos`/`wa_aberturas` | 1 mensagem a cada 2 min, só seg–sáb 9h–19h, aberturas sorteadas, lembrete único em 3 dias, respeita SAIR |
| Aprendizado | `api/whatsapp-sdr-aprendizado-cron.js` | 1x/dia (a cada 3 dias no máximo) lê as conversas e sugere lições; aparecem em Admin → Qualidade e só valem depois de "Marcar aplicada" |
| Vigia da conexão | mesmo cron da fila | Se a sessão cair, manda e-mail (uma vez por queda) |

## Passo a passo

### 1. Servidor da Evolution (fica ligado 24 h)
A Evolution não roda na Vercel (precisa de processo contínuo). Opções: VPS simples (Hostinger,
Contabo, DigitalOcean) com Docker, ou Railway/Render com o template oficial
(`github.com/evolution-foundation/evolution-api`). Ela precisa de Postgres e Redis — os templates já trazem.
Defina no `.env` da Evolution uma `AUTHENTICATION_API_KEY` forte (essa é a chave global).

### 2. Criar a instância e ler o QR code
No painel da Evolution (`https://SEU-SERVIDOR/manager`): **Create instance** → nome `bidpro` →
**Connect** → aparece o QR. No celular do número: WhatsApp Business → Aparelhos conectados →
Conectar aparelho → ler o QR.

### 3. Webhook da instância
Em **Webhook** da instância:
- URL: `https://www.bidprobrasil.com.br/api/whatsapp-evolution-webhook` (**com www**)
- Eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`
- Headers: `x-webhook-token: <o mesmo valor de WA_EVOLUTION_WEBHOOK_TOKEN>`
- "Webhook by events" desligado, "Base64" desligado.

### 4. Envs na Vercel (Production + Preview)
| Env | Valor |
|---|---|
| `EVOLUTION_URL` | `https://SEU-SERVIDOR` (sem barra no fim) |
| `EVOLUTION_APIKEY` | a chave global (ou o token da instância) |
| `EVOLUTION_INSTANCIA` | `bidpro` |
| `WA_EVOLUTION_WEBHOOK_TOKEN` | um texto aleatório longo (o mesmo do header do passo 3) |
| `WA_CANAL` | `evolution` |
| `WA_BOT_ATIVO` | `1` → a IA começa a responder |
| `VITE_WHATSAPP_NUMERO` | `5511964079726` → o widget do site passa a mandar o cliente para o WhatsApp |
| `WA_DISPAROS_ATIVO` | `1` só quando quiser ligar a fila ativa (padrão: desligada) |
| `WA_DISPARO_INTERVALO_S` | opcional, padrão `120` |
| `WA_DISPARO_TETO_DIA` | opcional, padrão `150` |

Conferir sem segredo: `GET https://www.bidprobrasil.com.br/api/whatsapp-evolution-webhook` devolve `{ escuta, responde, falta }`.

### 5. Teste
Mande "oi" de outro celular para o número. Em segundos: a IA responde, e o chamado aparece em
**Atendimento** com o selo WhatsApp. Responda pela tela: a mensagem chega no WhatsApp e a IA pausa.

## Fila ativa — como usar
Enfileirar (pelo SQL do Supabase ou pedindo ao Claude):
```sql
select public.wa_disparos_enfileirar_segmento('exploradores', 50);   -- contas grátis com telefone
select public.wa_disparos_enfileirar_segmento('sdr_leads', 50);      -- leads dos links SDR
select public.wa_disparos_enfileirar('[{"telefone":"11999998888","nome":"Ana"}]'::jsonb, 'lista_evento');
select * from public.wa_disparos_resumo();                            -- como está a fila
```
Editar/adicionar aberturas: tabela `wa_aberturas` (`etapa` 1 = abertura, 2 = lembrete; `{nome}` = primeiro nome).

## Riscos (ler antes de ligar a fila)
- Conexão não oficial vai contra os termos do WhatsApp. Bloqueio vem de **volume** e **denúncia**:
  só enfileire quem já tem relação com a BidPro, mantenha o intervalo e o teto, e não remova o "SAIR".
- Se o número for desativado pela operadora, ele se perde — inclusive para a API oficial. Resolver a
  portabilidade é a prioridade.
