import axios from 'axios'
import toast from 'react-hot-toast'

// In Docker: calls backend directly on port 8000
// In dev: uses Vite proxy to localhost:8000
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 globally
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

/**
 * downloadFile — BUG FIX for all broken exports.
 * window.location.href / window.open cannot send the Authorization header,
 * so every export returned 401. This helper uses the axios instance (which
 * always includes the token) and streams the response as a Blob download.
 */
export async function downloadFile(path, filename) {
  try {
    const response = await api.get(path, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    link.parentNode.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (err) {
    toast.error('Export failed — please try again')
    console.error('Download error:', err)
  }
}

export default api
