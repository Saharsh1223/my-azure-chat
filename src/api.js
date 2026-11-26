export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.redirected && response.url.includes('/.auth/login/')) {
    window.location.assign(response.url);
    throw new Error('Sign in to continue.');
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
