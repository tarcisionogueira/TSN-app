/**
 * GET /api/cnj-monitor-cron   (cron diário)
 * Reconsulta no CNJ DataJud cada processo monitorado e, se houver movimento novo
 * (ou novo risco de suspensão/atraso do leilão), avisa no chat interno do caso
 * e atualiza o snapshot. Importante: o DataJud não é tempo real — a novidade
 * aparece com o atraso da base + este intervalo (1x/dia).
 */
export const config = { runtime: 'edge', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { buscarProcessosCNJ } from './_cnj.js';
import { classificarDesfecho, registrarDesfechoJuridico } from './_arremate-aprendizado.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const ultimaData = p => (p?.movimentos || []).map(m => m.data).filter(Boolean).sort().slice(-1)[0] || p?.ultima_atualizacao || '';

/**
 * PERSISTE A SÉRIE DE MOVIMENTOS (15/08, pedido do dono: "o tempo entre despachos, para saber
 * se o processo está rápido").
 *
 * O snapshot guardava só `total_mov` e `ultima_data` — dava para saber que o processo mexeu,
 * NUNCA em que ritmo. Intervalo entre despachos é impossível de calcular a partir do último
 * despacho sozinho; a informação vinha do CNJ a cada rodada e era jogada fora aqui.
 *
 * O upsert é `ignore-duplicates` contra o índice único (numero, data, codigo, descricao): o
 * cron reconsulta todo dia e reencontra os mesmos movimentos. Sem isso a série duplicaria a
 * cada rodada e a mediana de intervalo tenderia a zero — um "processo muito ágil" fabricado
 * pelo próprio coletor, que é a família de erro que este projeto persegue.
 */
async function gravarMovimentos(numero, movimentos) {
  const linhas = (movimentos || [])
    .filter(m => m?.data)
    .map(m => ({ numero_processo: numero, data: m.data, codigo: m.codigo ?? null,
                 descricao: String(m.descricao || '').slice(0, 300), risco: m.risco || null }));
  if (!linhas.length) return 0;
  const r = await sb('processo_movimentos?on_conflict=numero_processo,data,codigo,descricao', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas });
  if (!r.ok) {
    // Falha aqui NÃO pode derrubar o monitoramento (o alerta de risco é o que urge), mas
    // também não pode sumir: sem série gravada a cadência fica muda e ninguém saberia por quê.
    console.error('[cnj-monitor] série NÃO gravada', numero, r.status, (await r.text().catch(() => '')).slice(0, 200));
    return 0;
  }
  return linhas.length;
}

async function avisarCaso(mon, texto) {
  if (!mon.caso_id) return;
  let [ch] = await (await sb(`chamados?caso_id=eq.${encodeURIComponent(mon.caso_id)}&segmento=eq.interno&select=id&limit=1`)).json();
  if (!ch) {
    [ch] = await (await sb('chamados', { method: 'POST', prefer: 'return=representation',
      body: { user_id: null, user_nome: 'Jurídico', titulo: `Jurídico — ${mon.rotulo || mon.numero_processo}`, status: 'em_atendimento', segmento: 'interno', caso_id: mon.caso_id } })).json();
  }
  if (ch?.id) await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
    body: { chamado_id: ch.id, autor_tipo: 'sistema', autor_nome: 'Monitor CNJ', conteudo: texto, anexos: [] } });
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  const monitores = await (await sb(`processos_monitorados?ativo=eq.true&select=*&order=ultima_checagem.asc.nullsfirst&limit=40`)).json();
  let checados = 0, alertas = 0, movimentosGravados = 0;

  for (const mon of (monitores || [])) {
    try {
      const r = await buscarProcessosCNJ({ numero_processo: mon.numero_processo, uf: mon.uf, nacional: !mon.uf });
      const proc = (r.processos || []).find(p => p.numero?.replace(/\D/g, '') === mon.numero_processo.replace(/\D/g, '')) || (r.processos || [])[0];
      checados++;
      if (!proc) {
        await sb(`processos_monitorados?id=eq.${mon.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_checagem: new Date().toISOString() } });
        continue;
      }
      const dataMov = ultimaData(proc);
      movimentosGravados += await gravarMovimentos(proc.numero || mon.numero_processo, proc.movimentos);
      const temSusp = !!proc.tem_suspensiva || !!proc.tem_bloqueante;
      const ant = mon.snapshot || {};
      const mudou = dataMov && dataMov !== mon.ultima_data_mov;
      const novoRisco = temSusp && !ant.tem_suspensiva;

      if (mudou || novoRisco) {
        const ultimoMov = (proc.movimentos || [])[0]?.descricao || 'movimento atualizado';
        const cats = [...new Set((proc.riscos || []).map(x => x.categoria))];
        await avisarCaso(mon, `🔔 Movimento novo no processo ${proc.numero} (${proc.tribunal}) em ${dataMov || 's/data'}: ${ultimoMov}.${temSusp ? ` ⚠️ Risco de suspensão/atraso${cats.length ? ` [${cats.join(', ')}]` : ''}.` : ''}`);
        alertas++;
      }

      // DESEMBARAÇO JURÍDICO: classifica a evolução (posse/carta/baixa/arquivamento/
      // trânsito) e grava no corpus de aprendizado do arremate (se for um). Ao
      // encerrar, avisa e desativa o monitor — cumprimos "consultar até o despacho
      // final". A IA aprende o desfecho por modalidade.
      const desfecho = classificarDesfecho(proc.movimentos);
      await registrarDesfechoJuridico(mon.imovel_id, proc, desfecho).catch(() => {});
      if (desfecho.encerrado) {
        await avisarCaso(mon, `✅ Processo ${proc.numero} (${proc.tribunal}) com desembaraço concluído: ${desfecho.marco || 'baixa/arquivamento'}${desfecho.data ? ` em ${desfecho.data}` : ''}. Acompanhamento no CNJ encerrado.`);
        await sb(`processos_monitorados?id=eq.${mon.id}`, { method: 'PATCH', prefer: 'return=minimal',
          body: { ativo: false, ultima_data_mov: dataMov || mon.ultima_data_mov, ultima_checagem: new Date().toISOString(),
            snapshot: { total_mov: (proc.movimentos || []).length, ultima_data: dataMov, tem_suspensiva: temSusp, encerrado: true, marco: desfecho.marco } } });
        continue;
      }

      await sb(`processos_monitorados?id=eq.${mon.id}`, { method: 'PATCH', prefer: 'return=minimal',
        body: { ultima_data_mov: dataMov || mon.ultima_data_mov, ultima_checagem: new Date().toISOString(),
          snapshot: { total_mov: (proc.movimentos || []).length, ultima_data: dataMov, tem_suspensiva: temSusp } } });
    } catch (_) {
      await sb(`processos_monitorados?id=eq.${mon.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_checagem: new Date().toISOString() } }).catch(() => {});
    }
  }

  return new Response(JSON.stringify({ ok: true, checados, alertas, movimentosGravados }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
