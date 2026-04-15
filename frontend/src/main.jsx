import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
    <Toaster position="top-right" toastOptions={{
      duration: 4000,
      style: { background: '#1A2B5F', color: '#fff', borderRadius: '8px' },
      success: { style: { background: '#065f46', color: '#fff' } },
      error: { style: { background: '#991b1b', color: '#fff' } },
    }} />
  </BrowserRouter>
)
