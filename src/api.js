export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-app-password': localStorage.getItem('app-password') || '', ...options.headers },
  });
  if (response.status === 401) {
    localStorage.removeItem('app-password');
    window.dispatchEvent(new Event('app-auth-required'));
    const error = new Error('Incorrect password. Please try again.');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

export function saveThread(changes) {
  return api('/threads', { method: 'POST', body: JSON.stringify(changes) });
}
