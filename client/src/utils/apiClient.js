import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';

function handle401(response) {
  if (response.status === 401) {
    useAuthStore.getState().clearAuth();
    useToolStore.getState().resetTool();
    window.location.replace('/login');
    return true;
  }
  return false;
}

const api = {
  async request(path, options = {}) {
    const { token } = useAuthStore.getState();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(path, { ...options, headers });
    if (handle401(response)) return;
    return response;
  },

  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  },

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body: JSON.stringify(body) });
  },

  put(path, body, options = {}) {
    return this.request(path, { ...options, method: 'PUT', body: JSON.stringify(body) });
  },

  delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  },
};

export default api;
