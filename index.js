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
app.use(cors({
  origin: function (origin, callback) {
    const allowedPatterns = [
      'localhost',
      'vercel.app',
      'render.com'
    ]
    
    if (!origin || allowedPatterns.some(pattern => origin.includes(pattern))) {
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

// Routes
app.use('/api/payment', require('./routes/payment'))
app.use('/api/orders', require('./routes/orders'))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'AgriLink backend is running 🌱' })
})

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'AgriLink backend API is running 🚀. Please use the frontend app to interact with the system.' })
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


