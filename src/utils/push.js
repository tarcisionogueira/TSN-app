// Gerencia Web Push Notifications no frontend

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BNQnHyI14FqAdg3R8hxiqGPhtLy-UkmxDLIkUcYN1-6LGE0ezXwf8Bx7_hQ7JRZwz7Gcd3e6qfvWIwVO_VtancU';

function urlB64ToUint8(b64) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function pushSuportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function statusPermissao() {
  if (!pushSuportado()) return 'nao_suportado';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function registrarServiceWorker() {
  if (!pushSuportado()) return null;
  return navigator.serviceWorker.register('/sw.js');
}

export async function ativarPush(session) {
  if (!pushSuportado()) throw new Error('Navegador não suporta push notifications');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada');

  const reg = await registrarServiceWorker();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(VAPID_PUBLIC),
  });

  await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ subscription: sub.toJSON(), action: 'subscribe' }),
  });

  return sub;
}

export async function desativarPush(session) {
  if (!pushSuportado()) return;

  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  if (reg) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  }

  await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ action: 'unsubscribe' }),
  });
}

export async function getSubscriptionAtiva() {
  if (!pushSuportado()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// Navega quando o service worker envia mensagem de clique em notificação
export function ouvirNavegacao(navigate) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'NAVIGATE' && e.data.url) navigate(e.data.url);
  });
}
