import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../utils/api'
import toast from 'react-hot-toast'
import { Eye, EyeOff, KeyRound } from 'lucide-react'

/**
 * Forced first-login password change.
 * Shown whenever the signed-in user's must_change_password flag is true
 * (new account created by an admin, or an admin-initiated password reset).
 * The user cannot reach any other page until they set their own password.
 */
export default function ChangePasswordPage() {
  const { user, logout, updateUser } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)

  // Already changed - nothing to enforce, send them back into the app.
  if (user && !user.must_change_password) {
    navigate('/', { replace: true })
    return null
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.current_password) return toast.error('Enter your current password')
    if (form.new_password.length < 8) return toast.error('New password must be at least 8 characters')
    if (form.new_password === form.current_password) return toast.error('New password must be different from your current password')
    if (form.new_password !== form.confirm_password) return toast.error('New passwords do not match')

    setLoading(true)
    try {
      await api.put('/auth/me', {
        current_password: form.current_password,
        new_password: form.new_password,
      })
      updateUser({ must_change_password: false })
      toast.success('Password updated')
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy to-navy-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/10 backdrop-blur rounded-2xl p-6 mb-6 text-center">
          <h1 className="text-white text-xl font-bold">Academies Australasia</h1>
          <p className="text-cyan text-sm">ECEC Work Placement Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={20} className="text-navy" />
            <h2 className="text-xl font-semibold text-navy">Set a New Password</h2>
          </div>
          <p className="text-gray-500 text-sm mb-6">
            For account security, you must set your own password before continuing.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Current (temporary) password</label>
              <div className="relative">
                <input type={showCurrent ? 'text' : 'password'} required
                  className="input pr-10" placeholder="••••••••"
                  value={form.current_password}
                  onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))} />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">New password</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} required minLength={8}
                  className="input pr-10" placeholder="At least 8 characters"
                  value={form.new_password}
                  onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} />
                <button type="button" onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input type={showNew ? 'text' : 'password'} required minLength={8}
                className="input" placeholder="Re-enter new password"
                value={form.confirm_password}
                onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} />
            </div>
            <button type="submit" disabled={loading}
              className="btn-primary w-full justify-center py-2.5 mt-2">
              {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : <KeyRound size={16} />}
              {loading ? 'Updating...' : 'Update Password & Continue'}
            </button>
          </form>

          <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 mt-4 w-full text-center">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
