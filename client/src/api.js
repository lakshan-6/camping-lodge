export const getToken = () => localStorage.getItem('cl_token');
export const setToken = t => (t ? localStorage.setItem('cl_token', t) : localStorage.removeItem('cl_token'));

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = 'Bearer ' + getToken();
  const res = await fetch('/api' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) { setToken(null); location.reload(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export const lkr = n => 'LKR ' + Number(n || 0).toLocaleString('en-LK');
