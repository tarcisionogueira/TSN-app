// TEMPORÁRIO — testa a mensagem de erro REAL que o GoTrue devolve quando o trigger
// trg_bloquear_email_descartavel recusa o cadastro, pra confirmar se o texto customizado
// chega ao navegador ou se é achatado (mesmo achado já documentado em erroAuth.js pro
// handle_new_user). Não usa chave secreta — só a publishable key (igual o front-end).
const URL = 'https://zuwfiwokkdytvjixiwac.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1d2Zpd29ra2R5dHZqaXhpd2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MzI0OTAsImV4cCI6MjA5NzEwODQ5MH0.N0SbncKgwgRJ7fFA_GKhPNNoc_Hs9KUXfBebczJqkqQ';

async function main() {
  const r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `teste_bloqueio_${Date.now()}@mailinator.com`, password: `Xk9#mQ2v${Date.now()}Zp!` }),
  });
  console.log('status:', r.status);
  console.log('body:', await r.text());
}
main();
