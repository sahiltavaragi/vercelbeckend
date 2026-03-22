require('dotenv').config()

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
  origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
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

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🌱 AgriLink backend running on http://localhost:${PORT}`)
  })
}

module.exports = app


