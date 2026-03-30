require('dotenv').config()
const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const Razorpay = require('razorpay')
const supabase = require('./lib/supabase')

const app = express()

const PORT = process.env.PORT || 5000
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// Middlewares
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})
// Manual CORS headers for extra reliability
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && (origin.includes('vercel.app') || origin.includes('localhost') || origin.includes('render.com'))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  next()
})

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin.includes('vercel.app') || origin.includes('localhost') || origin.includes('render.com')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}))

// Raw body for Razorpay webhook signature verification
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

// --- GLOBAL DEBUG LOGGING ---
app.use((req, res, next) => {
  console.log(`[DEBUG] Received ${req.method} request to: "${req.url}" (Path: "${req.path}")`)
  next()
})

const razorpay = new Razorpay({
  key_id: (process.env.RAZORPAY_KEY_ID || '').trim(),
  key_secret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
})

// --- UNIVERSAL PATH CATCHER (Ultimate 404 Fix) ---
app.post('*', async (req, res, next) => {
  const url = req.url
  console.log(`[ROUTE-CATCHER] Method: ${req.method}, URL: ${url}`)

  // Match Create Order
  if (url.endsWith('/create-order')) {
    const startTime = Date.now()
    console.log('--- Order Creation Triggered (Universal) ---', { body: req.body })
    try {
      const { amount, userId, items, address } = req.body
      if (!amount || !userId) return res.status(400).json({ message: 'Amount and userId are required' })

      console.log(`[PERF] Starting Razorpay order creation for User: ${userId}`)
      const order = await razorpay.orders.create({
        amount: Math.round(Number(amount) * 100),
        currency: 'INR',
        receipt: `receipt_${Date.now()}`,
        notes: { userId: userId.toString() },
      })
      console.log(`[PERF] Razorpay order created in ${Date.now() - startTime}ms: ${order.id}`)

      const dbStart = Date.now()
      await supabase.from('orders').insert({
        user_id: userId,
        total_amount: amount,
        status: 'pending',
        payment_method: 'razorpay',
        payment_status: 'pending',
        razorpay_order_id: order.id,
        delivery_address: address,
      })
      console.log(`[PERF] Supabase order inserted in ${Date.now() - dbStart}ms`)

      console.log(`[PERF] Total /create-order time: ${Date.now() - startTime}ms`)
      return res.json(order)
    } catch (err) {
      console.error('--- Payment Processing Error ---', err.message)
      return res.status(500).json({ message: 'Payment error', error: err.message })
    }
  }

  // Match Verify
  if (url.endsWith('/verify')) {
    console.log('--- Payment Verification Triggered (Universal) ---', req.body)
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, items, address } = req.body
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        console.error('Missing Razorpay verification fields', req.body)
        return res.status(400).json({ success: false, message: 'Missing verification fields' })
      }

      const body = razorpay_order_id + "|" + razorpay_payment_id
      const expectedSignature = crypto
        .createHmac('sha256', (process.env.RAZORPAY_KEY_SECRET || '').trim())
        .update(body.toString())
        .digest('hex')

      if (expectedSignature === razorpay_signature) {
          const { data: ord } = await supabase.from('orders').select('id').eq('razorpay_order_id', razorpay_order_id).single()
          if (ord) {
            await supabase.from('orders').update({ payment_status: 'paid', status: 'confirmed', razorpay_payment_id, razorpay_signature }).eq('id', ord.id)
            if (items && items.length > 0) {
              const orderItems = items.map(item => ({ order_id: ord.id, product_id: item.id, seller_id: item.seller_id, quantity: item.quantity, price_at_time: item.price }))
              await supabase.from('order_items').insert(orderItems)
              for (const item of items) {
                const { data: prod } = await supabase.from('products').select('quantity').eq('id', item.id).single()
                if (prod) await supabase.from('products').update({ quantity: Math.max(0, prod.quantity - item.quantity) }).eq('id', item.id)
              }
            }
          }
          return res.json({ success: true, message: 'Payment verified successfully' })
      } else {
        console.warn('Invalid signature detected')
        return res.status(400).json({ success: false, message: 'Invalid signature' })
      }
    } catch (err) {
      console.error('CRITICAL Verification error:', err.message)
      return res.status(500).json({ success: false, message: 'Verification crashed', error: err.message })
    }
  }

  // If not matched, go to next
  next()
})

// Normal Routers
app.use('/api/payment', require('./routes/payment'))
app.use('/api/orders', require('./routes/orders'))

// Health check (v3.1.0)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    version: '3.1.0',
    fix: 'robust-verify-logic',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT
    }
  })
})

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'AgriLink backend API is running 🚀' })
})

// 404 handler with Path Logging
app.use((req, res) => {
  console.log(`[404] Route Not Found: ${req.method} ${req.url}`)
  res.status(404).json({ 
    error: 'Route not found', 
    requestedPath: req.url,
    method: req.method 
  })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

// On Vercel, the app is exported and handled by the builder.
// On Render, Docker, or local machines, we need to call app.listen.
if (process.env.VERCEL) {
  module.exports = app
} else {
  app.listen(PORT, () => {
    console.log(`🌱 AgriLink backend running on port ${PORT}`)
  })
}


