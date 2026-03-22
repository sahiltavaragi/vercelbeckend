const express = require('express')
const router = express.Router()
const Razorpay = require('razorpay')
const crypto = require('crypto')
const supabase = require('../lib/supabase')

const razorpay = new Razorpay({
  key_id: (process.env.RAZORPAY_KEY_ID || '').trim(),
  key_secret: (process.env.RAZORPAY_KEY_SECRET || '').trim(),
})

// GET /api/payment/test
router.get('/test', (req, res) => {
  res.json({ message: 'Payment router GET /test is working' })
})

// POST /api/payment/test-post
router.post('/test-post', (req, res) => {
  res.json({ message: 'Payment router POST /test-post is working', body: req.body })
})

// POST /api/payment/create-order
router.post('/create-order', async (req, res) => {
  console.log('--- Create Order Request ---', req.body)
  try {
    const { amount, userId, items, address } = req.body
    
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('RAZORPAY_KEYs are missing in backend .env')
      return res.status(500).json({ message: 'Razorpay configuration missing' })
    }

    if (!amount || !userId) {
      return res.status(400).json({ message: 'Amount and userId are required' })
    }

    const options = {
      amount: Math.round(Number(amount) * 100), // Razorpay expects paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { 
        userId: userId.toString(),
      },
    }

    console.log('--- Attempting Razorpay order.create ---', options)
    const order = await razorpay.orders.create(options)
    console.log('--- Razorpay Order SUCCESS ---', order.id)

    // Store pending order in Supabase
    const { error } = await supabase.from('orders').insert({
      user_id: userId,
      total_amount: amount,
      status: 'pending',
      payment_method: 'razorpay',
      payment_status: 'pending',
      razorpay_order_id: order.id,
      delivery_address: address,
    })
    
    if (error) {
      console.error('DB error storing pending order:', error)
      // We don't return error here because the Razorpay order is already created
    }

    res.json(order)
  } catch (err) {
    console.error('--- Razorpay Order FAILURE ---', err.message)
    res.status(500).json({ 
      message: 'Failed to create payment order', 
      error: err.message 
    })
  }
})

// POST /api/payment/verify
router.post('/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, items, address } = req.body

  const body = razorpay_order_id + "|" + razorpay_payment_id
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex')

  if (expectedSignature === razorpay_signature) {
    try {
      // 1. Check if order exists in DB
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('*')
        .eq('razorpay_order_id', razorpay_order_id)
        .single()

      if (existingOrder) {
        // Update existing order
        await supabase
          .from('orders')
          .update({ 
            payment_status: 'paid',
            status: 'confirmed',
            razorpay_payment_id,
            razorpay_signature,
          })
          .eq('razorpay_order_id', razorpay_order_id)
      } else {
        // Create new order if it doesn't exist (failsafe)
        const { data: order, error } = await supabase
          .from('orders')
          .insert({
            user_id: userId,
            total_amount: req.body.amount || 0,
            status: 'confirmed',
            payment_method: 'razorpay',
            payment_status: 'paid',
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            delivery_address: address,
          })
          .select()
          .single()

        if (error) throw error
      }

      // Insert order items and update stock if they don't exist yet
      if (items && items.length > 0) {
        // Re-fetch order to get its internal ID
        const { data: ord } = await supabase
          .from('orders')
          .select('id')
          .eq('razorpay_order_id', razorpay_order_id)
          .single()

        if (ord) {
          // Check if items already inserted (to avoid double insertion on retry)
          const { data: existingItems } = await supabase
            .from('order_items')
            .select('id')
            .eq('order_id', ord.id)
          
          if (!existingItems || existingItems.length === 0) {
            const orderItems = items.map(item => ({
              order_id: ord.id,
              product_id: item.id,
              seller_id: item.seller_id,
              quantity: item.quantity,
              price_at_time: item.price,
            }))

            await supabase.from('order_items').insert(orderItems)
            
            // Stock update
            for (const item of items) {
              const { data: prod } = await supabase.from('products').select('quantity').eq('id', item.id).single()
              if (prod) {
                await supabase.from('products').update({ quantity: Math.max(0, prod.quantity - item.quantity) }).eq('id', item.id)
              }
            }
          }
        }
      }

      res.json({ success: true, message: 'Payment verified successfully' })
    } catch (err) {
      console.error('Verification error:', err)
      res.status(500).json({ success: false, message: 'Internal server error' })
    }
  } else {
    res.status(400).json({ success: false, message: 'Invalid signature' })
  }
})

module.exports = router
