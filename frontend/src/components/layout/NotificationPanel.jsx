import React, { useEffect, useState } from 'react'
import { Bell, X, CheckCheck } from 'lucide-react'
import api from '../../utils/api'
import { formatDistanceToNow } from 'date-fns'

export default function NotificationPanel({ onClose }) {
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    api.get('/notifications?unread_only=false').then(r => setNotifications(r.data)).catch(() => {})
  }, [])

  const markAllRead = async () => {
    await api.put('/notifications/read-all')
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const typeColor = { info: 'bg-blue-100 text-blue-600', warning: 'bg-yellow-100 text-yellow-600', error: 'bg-red-100 text-red-600', success: 'bg-green-100 text-green-600' }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2"><Bell size={15} /> Notifications</h3>
        <div className="flex items-center gap-2">
          <button onClick={markAllRead} className="text-xs text-cyan hover:underline flex items-center gap-1">
            <CheckCheck size={12} /> Mark all read
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">No notifications</p>
        ) : notifications.map(n => (
          <div key={n.id} className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${!n.read ? 'bg-blue-50/50' : ''}`}>
            <div className="flex items-start gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium mt-0.5 flex-shrink-0 ${typeColor[n.type] || typeColor.info}`}>
                {n.type}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : ''}
                </p>
              </div>
              {!n.read && <div className="w-2 h-2 bg-cyan rounded-full flex-shrink-0 mt-1" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
