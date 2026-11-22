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

### 1–3. Servidor, QR e webhook — instalador automático (`infra/evolution/`)
O instalador sobe Evolution + Postgres + Redis + Caddy (HTTPS) numa VPS Ubuntu, gera as chaves,
cria a instância `bidpro` (recusa ligação, ignora grupo), configura o webhook com o header
`x-webhook-token` e mostra o QR **no próprio terminal**. Os segredos ficam só em `/opt/evolution/.env`.

1. **VPS**: Ubuntu 22.04/24.04, 2 GB de RAM basta (Hostinger KVM 1, Contabo, DigitalOcean). Anote o IP.
2. **DNS (Registro.br)**: bidprobrasil.com.br → DNS → nova entrada **A**, nome `wa`, valor = IP da VPS.
3. **No terminal da VPS** (`ssh root@IP`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/tarcisionogueira/TSN-app/main/infra/evolution/instalar.sh | sudo bash
   ```
   Se o DNS ainda não propagou, ele para e avisa; rode de novo depois.
4. **Celular do número**: WhatsApp Business → Aparelhos conectados → Conectar aparelho → ler o QR
   do terminal. Sem câmera à mão: `sudo bash /opt/evolution/instalar.sh codigo` (código de 8 letras).
5. No fim ele imprime as envs da Vercel prontas (passo 4). Reimprimir: `sudo bash /opt/evolution/instalar.sh envs`.

Manutenção: `instalar.sh status` (estado) · `instalar.sh qr` (sessão caiu) · rodar sem argumento de
novo é seguro (não apaga nada). Atualizar a Evolution: trocar `EVOLUTION_TAG` no `.env` e
`cd /opt/evolution && docker compose pull && docker compose up -d`.

### 4. Envs na Vercel (Production + Preview)
| Env | Valor |
|---|---|
| `EVOLUTION_URL` | `https://wa.bidprobrasil.com.br` |
| `EVOLUTION_APIKEY` | a `AUTHENTICATION_API_KEY` que o instalador gerou |
| `EVOLUTION_INSTANCIA` | `bidpro` |
| `WA_EVOLUTION_WEBHOOK_TOKEN` | o `BIDPRO_WEBHOOK_TOKEN` que o instalador gerou |
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
