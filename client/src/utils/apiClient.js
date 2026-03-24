import useAuthStore from '../store/authStore';

const api = {
  request(path, options = {}) {
    const { token } = useAuthStore.getState();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(path, { ...options, headers });
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
