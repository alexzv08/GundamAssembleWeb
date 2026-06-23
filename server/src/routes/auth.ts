import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase'

const router = Router()

router.delete('/delete-account', async (req, res) => {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  if (!token) {
    res.status(401).json({ error: 'No token' })
    return
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

export default router
