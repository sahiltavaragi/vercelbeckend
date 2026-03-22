require('dotenv').config()

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET'
]

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0 && process.env.VERCEL) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

const express = require('express')
const cors = require('cors')
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

// Consolidated Logic for /api/payment/create-order (Wildcard match to bypass path issues)
const Razorpay = require('razorpay')
const razorpay = new Razorpay({
  key_id: (process.env.RAZORPAY_KEY_ID || '').trim(),
  key_secret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
})
const supabase = require('./lib/supabase')

// Match any path ending in /create-order
app.post('**/create-order', async (req, res) => {
  console.log('--- Order Creation Triggered ---', { path: req.path, body: !!req.body })
  try {
    const { amount, userId, items, address } = req.body
    if (!amount || !userId) {
      console.warn('Missing amount or userId in request body', req.body)
      return res.status(400).json({ message: 'Amount and userId are required' })
    }

    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100),
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { userId: userId.toString() },
    })

    await supabase.from('orders').insert({
      user_id: userId,
      total_amount: amount,
      status: 'pending',
      payment_method: 'razorpay',
      payment_status: 'pending',
      razorpay_order_id: order.id,
      delivery_address: address,
    })

    res.json(order)
  } catch (err) {
    console.error('--- Payment Processing Error ---', err.message)
    res.status(500).json({ message: 'Payment error', error: err.message })
  }
})

// Normal Routers (for other routes)
app.use('/api/payment', require('./routes/payment'))
app.use('/api/orders', require('./routes/orders'))

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'AgriLink backend is running 🌱',
    env: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: !!process.env.VERCEL,
      PORT: process.env.PORT
    }
  })
})

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'AgriLink backend API is running 🚀' })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
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


