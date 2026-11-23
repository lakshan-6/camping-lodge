export const getToken = () => localStorage.getItem('cl_token');
export const setToken = t => (t ? localStorage.setItem('cl_token', t) : localStorage.removeItem('cl_token'));

export async function api(path, opts = {}) {
  const {timeoutMs = 90000, ...options} = opts;
  const reading = (options.method || 'GET').toUpperCase() === 'GET';
  const controller = reading && !options.signal ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = 'Bearer ' + getToken();
  try {
    let res;
    try {
      res = await fetch('/api' + path, {
        ...options, headers,
        signal: controller?.signal || options.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      const message = controller?.signal.aborted
        ? 'The server is taking longer than expected. Please try again.'
        : reading
          ? 'Could not connect to Camping Lodge. Check your connection and try again.'
          : 'The connection was interrupted. Check whether your change was saved before trying again.';
      throw Object.assign(new Error(message), {status: 0});
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith('/auth/')) { setToken(null); location.reload(); }
    if (!res.ok) throw Object.assign(new Error(data?.error || 'Camping Lodge is temporarily unavailable. Please try again.'), {status: res.status});
    if (data === null) throw Object.assign(new Error('The server has not finished responding. Please try again.'), {status: 502});
    return data;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
export const lkr = n => 'LKR ' + Number(n || 0).toLocaleString('en-LK');
