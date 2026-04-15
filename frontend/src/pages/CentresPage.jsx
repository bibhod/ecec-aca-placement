/**
 * CentresPage — fixes Issues 7 and 11:
 *   Issue 7:  Google Maps Places autocomplete for the address field
 *   Issue 11: Rename "NQS" label → "National Quality Standard (NQS)"
 */
import React, { useEffect, useState, useRef } from 'react'
import { Plus, Building2, MapPin, Phone, Star } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../utils/api'
import { PageHeader, Spinner, Badge, Modal, FormRow, Select, EmptyState, SearchInput } from '../components/ui/index'

const NQS_RATINGS = ['Excellent', 'Exceeding NQS', 'Meeting NQS', 'Working Towards NQS', 'Significant Improvement Required']
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']

const emptyForm = {
  centre_name: '', address: '', suburb: '', state: 'NSW', postcode: '',
  phone: '', email: '', director_name: '', director_email: '',
  supervisor_name: '', supervisor_email: '', supervisor_phone: '',
  nqs_rating: 'Meeting NQS', approved: true, notes: '',
  latitude: null, longitude: null, max_students: 5,
}

/**
 * AddressAutocomplete — Issue 7
 * Uses Google Maps Places API (Autocomplete widget) if VITE_GOOGLE_MAPS_API_KEY is set;
 * otherwise falls back to a plain text input.
 */
function AddressAutocomplete({ value, onChange, onPlaceSelected }) {
  const inputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (!apiKey || !window.google || !inputRef.current) return
    if (autocompleteRef.current) return  // already initialised

    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'au' },
    })

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace()
      if (!place.geometry) return

      const components = place.address_components || []
      const get = (type) => {
        const c = components.find(c => c.types.includes(type))
        return c ? c.long_name : ''
      }
      const getShort = (type) => {
        const c = components.find(c => c.types.includes(type))
        return c ? c.short_name : ''
      }

      const streetNumber = get('street_number')
      const route = get('route')
      const address = [streetNumber, route].filter(Boolean).join(' ')
      const suburb = get('locality') || get('sublocality')
      const state = getShort('administrative_area_level_1')
      const postcode = get('postal_code')
      const lat = place.geometry.location.lat()
      const lng = place.geometry.location.lng()

      onPlaceSelected({ address, suburb, state, postcode, latitude: lat, longitude: lng })
    })
  }, [apiKey])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={apiKey ? 'Start typing to search addresses…' : 'Street address (set VITE_GOOGLE_MAPS_API_KEY for autocomplete)'}
      />
      {!apiKey && (
        <p className="text-xs text-gray-400 mt-0.5">
          Add <code className="bg-gray-100 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code> to .env for address autocomplete.
        </p>
      )}
    </div>
  )
}

export default function CentresPage() {
  const [centres, setCentres] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editCentre, setEditCentre] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/centres').then(r => setCentres(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  // Inject Google Maps script if API key is available
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!apiKey || document.getElementById('google-maps-script')) return
    const script = document.createElement('script')
    script.id = 'google-maps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    document.head.appendChild(script)
  }, [])

  const openAdd = () => { setEditCentre(null); setForm(emptyForm); setShowModal(true) }
  const openEdit = c => {
    setEditCentre(c)
    setForm({
      centre_name: c.centre_name, address: c.address || '', suburb: c.suburb || '',
      state: c.state || 'NSW', postcode: c.postcode || '', phone: c.phone || '',
      email: c.email || '', director_name: c.director_name || '',
      director_email: c.director_email || '', supervisor_name: c.supervisor_name || '',
      supervisor_email: c.supervisor_email || '', supervisor_phone: c.supervisor_phone || '',
      nqs_rating: c.nqs_rating || 'Meeting NQS', approved: c.approved,
      notes: c.notes || '', latitude: c.latitude || null, longitude: c.longitude || null,
      max_students: c.max_students || 5,
    })
    setShowModal(true)
  }

  const save = async () => {
    if (!form.centre_name) return toast.error('Centre name required')
    setSaving(true)
    try {
      if (editCentre) { await api.put(`/centres/${editCentre.id}`, form); toast.success('Centre updated') }
      else { await api.post('/centres', form); toast.success('Centre added') }
      setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') } finally { setSaving(false) }
  }

  const filtered = centres.filter(c =>
    !search || c.centre_name.toLowerCase().includes(search.toLowerCase()) ||
    c.suburb?.toLowerCase().includes(search.toLowerCase())
  )

  const nqsColor = {
    'Excellent': 'badge-green', 'Exceeding NQS': 'badge-green',
    'Meeting NQS': 'badge-blue', 'Working Towards NQS': 'badge-yellow',
    'Significant Improvement Required': 'badge-red',
  }

  if (loading) return <div className="p-8"><Spinner size="lg" /></div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader title="Placement Centres" subtitle={`${centres.length} approved centres`}
        actions={<button onClick={openAdd} className="btn-primary text-sm"><Plus size={15} /> Add Centre</button>} />

      <div className="mb-6">
        <SearchInput value={search} onChange={setSearch} placeholder="Search centres..." />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No centres found"
          action={<button onClick={openAdd} className="btn-primary mx-auto"><Plus size={15} /> Add Centre</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c.id} className="card hover:shadow-md cursor-pointer transition-all hover:-translate-y-0.5" onClick={() => openEdit(c)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-navy/10 flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} className="text-navy" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">{c.centre_name}</h3>
                    {c.student_count !== undefined && (
                      <p className="text-xs text-gray-400">{c.student_count} active student{c.student_count !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>
                <Badge status={c.approved ? 'active' : 'withdrawn'} label={c.approved ? 'Approved' : 'Not Approved'} />
              </div>
              {(c.suburb || c.state) && (
                <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                  <MapPin size={11} />{[c.address, c.suburb, c.state, c.postcode].filter(Boolean).join(', ')}
                </p>
              )}
              {c.phone && <p className="text-xs text-gray-500 flex items-center gap-1 mb-1"><Phone size={11} />{c.phone}</p>}
              {c.supervisor_name && <p className="text-xs text-gray-500 mt-2">Supervisor: <strong>{c.supervisor_name}</strong></p>}
              {c.nqs_rating && (
                <div className="mt-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${nqsColor[c.nqs_rating] || 'badge-gray'}`}>
                    <Star size={10} className="inline mr-1" />{c.nqs_rating}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editCentre ? 'Edit Centre' : 'Add Placement Centre'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full">
            <FormRow label="Centre Name" required>
              <input className="input" value={form.centre_name} onChange={e => setForm(f => ({ ...f, centre_name: e.target.value }))} />
            </FormRow>
          </div>

          {/* Issue 7 — Google Maps address autocomplete */}
          <div className="col-span-full">
            <FormRow label="Address">
              <AddressAutocomplete
                value={form.address}
                onChange={v => setForm(f => ({ ...f, address: v }))}
                onPlaceSelected={({ address, suburb, state, postcode, latitude, longitude }) =>
                  setForm(f => ({ ...f, address, suburb, state, postcode, latitude, longitude }))
                }
              />
            </FormRow>
          </div>

          <FormRow label="Suburb">
            <input className="input" value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} />
          </FormRow>
          <FormRow label="State">
            <Select value={form.state} onChange={v => setForm(f => ({ ...f, state: v }))} options={AU_STATES.map(s => ({ value: s, label: s }))} placeholder="" />
          </FormRow>
          <FormRow label="Postcode">
            <input className="input" value={form.postcode} onChange={e => setForm(f => ({ ...f, postcode: e.target.value }))} />
          </FormRow>
          <FormRow label="Phone">
            <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </FormRow>
          <FormRow label="Email">
            <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </FormRow>
          <FormRow label="Max Students">
            <input className="input" type="number" min="1" max="50" value={form.max_students} onChange={e => setForm(f => ({ ...f, max_students: +e.target.value }))} />
          </FormRow>

          <div className="col-span-full border-t border-gray-100 pt-4 mt-1">
            <p className="text-sm font-medium text-gray-700 mb-3">Director Details</p>
          </div>
          <FormRow label="Director Name"><input className="input" value={form.director_name} onChange={e => setForm(f => ({ ...f, director_name: e.target.value }))} /></FormRow>
          <FormRow label="Director Email"><input className="input" type="email" value={form.director_email} onChange={e => setForm(f => ({ ...f, director_email: e.target.value }))} /></FormRow>

          <div className="col-span-full border-t border-gray-100 pt-4 mt-1">
            <p className="text-sm font-medium text-gray-700 mb-3">Trainer/Assessor Contact Details</p>
          </div>
          <FormRow label="Trainer/Assessor Name"><input className="input" value={form.supervisor_name} onChange={e => setForm(f => ({ ...f, supervisor_name: e.target.value }))} /></FormRow>
          <FormRow label="Trainer/Assessor Email"><input className="input" type="email" value={form.supervisor_email} onChange={e => setForm(f => ({ ...f, supervisor_email: e.target.value }))} /></FormRow>
          <FormRow label="Trainer/Assessor Phone"><input className="input" value={form.supervisor_phone} onChange={e => setForm(f => ({ ...f, supervisor_phone: e.target.value }))} /></FormRow>

          {/* Issue 11 — full label "National Quality Standard (NQS)" */}
          <FormRow label="National Quality Standard (NQS)">
            <Select value={form.nqs_rating} onChange={v => setForm(f => ({ ...f, nqs_rating: v }))}
              options={NQS_RATINGS.map(r => ({ value: r, label: r }))} placeholder="" />
          </FormRow>

          <div className="col-span-full flex items-center gap-2">
            <input type="checkbox" id="approved" checked={form.approved}
              onChange={e => setForm(f => ({ ...f, approved: e.target.checked }))} className="w-4 h-4 accent-cyan" />
            <label htmlFor="approved" className="text-sm text-gray-700">Centre is approved for student placements</label>
          </div>
          <div className="col-span-full">
            <FormRow label="Notes">
              <textarea className="input h-20 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </FormRow>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : editCentre ? 'Update Centre' : 'Add Centre'}</button>
        </div>
      </Modal>
    </div>
  )
}
