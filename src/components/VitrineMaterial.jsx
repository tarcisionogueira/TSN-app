import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, GraduationCap, BookOpen } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * VITRINE — a faixa que sinaliza, na home de quem já entrou, um material que a pessoa
 * ainda não abriu.
 *
 * PEDIDO DO DONO (11/08): "uma forma de promoção de divulgação onde inclui um curso ou um
 * eBook, poder sinalizar isso ao usuário". Promover, não descontar — foi a palavra dele:
 * "foi de promover mesmo o material que é colocado lá".
 *
 * POR QUE AQUI E NÃO NA ÁREA DE MEMBROS: quem entra na Área de Membros já está procurando
 * material. O problema é justamente quem nunca vai lá. Esta faixa aparece na PRIMEIRA tela
 * depois do login, que é a que todo mundo vê.
 *
 * O que ela mostra: entre os materiais marcados como DESTAQUE no cadastro, o que esta pessoa
 * ainda não abriu. Sem destaque marcado, não aparece nada — a faixa é do dono, não automática,
 * porque ocupar a home de todo cliente é uma decisão editorial e não um efeito colateral.
 */

const DISPENSA_KEY = 'tsn_vitrine_dispensada';   // por sessão: volta no próximo acesso
const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'clube'];

export default function VitrineMaterial() {
  const { user, role, impersonate, effectiveUserId } = useAuth();
  const nav = useNavigate();
  const [item, setItem] = useState(null);

  useEffect(() => {
    if (!user || impersonate || !ROLES_CLIENTE.includes(role)) return;
    if (sessionStorage.getItem(DISPENSA_KEY) === '1') return;

    let vivo = true;
    (async () => {
      const [cursosR, ebooksR, progR] = await Promise.all([
        // O curso de ONBOARDING fica de fora: ele tem o pop-up de boas-vindas como caminho
        // próprio, e anunciar duas vezes a mesma coisa na mesma tela é ruído.
        supabase.from('cursos_admin').select('id, titulo, subtitulo, capa_url, cor, preco')
          .eq('ativo', true).eq('destaque', true).eq('onboarding', false).order('criado_em', { ascending: false }),
        supabase.from('ebooks_admin').select('id, titulo, descricao, capa_url, preco')
          .eq('ativo', true).eq('destaque', true).order('criado_em', { ascending: false }),
        supabase.from('aula_progresso').select('curso_id').eq('user_id', effectiveUserId || user.id),
      ]);
      if (!vivo) return;
      // Falha de leitura não vira "não há destaque": simplesmente não mostramos a faixa
      // (é enfeite, não conteúdo), mas fica o rastro no console em vez do silêncio total.
      if (cursosR.error || ebooksR.error) {
        console.warn('[vitrine]', cursosR.error?.message || ebooksR.error?.message);
        return;
      }
      const jaAbriu = new Set((progR.data || []).map((p) => p.curso_id));
      const cursos = (cursosR.data || [])
        .filter((c) => !jaAbriu.has(c.id))
        .map((c) => ({ tipo: 'curso', id: c.id, titulo: c.titulo, sub: c.subtitulo, capa: c.capa_url, cor: c.cor || '#0D63DB', preco: c.preco }));
      const ebooks = (ebooksR.data || [])
        .map((e) => ({ tipo: 'ebook', id: e.id, titulo: e.titulo, sub: (e.descricao || '').slice(0, 110), capa: e.capa_url, cor: '#0D63DB', preco: e.preco }));

      const lista = [...cursos, ...ebooks];
      if (lista.length) setItem(lista[0]);
    })();
    return () => { vivo = false; };
  }, [user, role, impersonate]);

  if (!item) return null;

  const Icone = item.tipo === 'curso' ? GraduationCap : BookOpen;
  const rotulo = item.tipo === 'curso' ? 'Curso' : 'eBook';
  const gratis = !Number(item.preco || 0);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      background: `linear-gradient(135deg, ${item.cor}12 0%, white 65%)`,
      border: `1px solid ${item.cor}33`, borderRadius: 14, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${item.cor} 0%, ${item.cor}cc 100%)`,
      }}>
        <Icone size={20} color="white" />
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: item.cor, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 3 }}>
          {rotulo} em destaque{gratis ? ' · grátis' : ''}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>{item.titulo}</div>
        {item.sub && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{item.sub}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={() => nav(item.tipo === 'curso' ? `/membros/curso/${item.id}` : `/p/ebook/${item.id}`)}
          style={{ background: item.cor, color: 'white', border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {gratis ? 'Acessar' : 'Ver'} <ArrowRight size={14} />
        </button>
        <button
          onClick={() => { sessionStorage.setItem(DISPENSA_KEY, '1'); setItem(null); }}
          aria-label="Dispensar"
          style={{ background: 'transparent', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={15} color="#94a3b8" />
        </button>
      </div>
    </div>
  );
}
