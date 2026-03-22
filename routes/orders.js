const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')

// POST /api/orders/cod – Cash on Delivery
router.post('/cod', async (req, res) => {
  try {
    const { userId, items, address, total } = req.body
    if (!userId || !items?.length || !total) {
      return res.status(400).json({ message: 'Missing required fields' })
    }

    // Create order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        total_amount: total,
        status: 'confirmed',
        payment_method: 'cod',
        payment_status: 'pending',
      })
      .select()
      .single()

    if (orderErr) throw orderErr

    // Insert order items
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.id,
      seller_id: item.seller_id,
      quantity: item.quantity,
      price_at_time: item.price,
    }))

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)
    if (itemsErr) throw itemsErr

    // Reduce product stock
    for (const item of items) {
      const { data: product } = await supabase.from('products').select('quantity').eq('id', item.id).single()
      if (product) {
        await supabase.from('products').update({ quantity: Math.max(0, product.quantity - item.quantity) }).eq('id', item.id)
      }
    }

    res.json({ success: true, orderId: order.id })
  } catch (err) {
    console.error('COD order error:', err)
    res.status(500).json({ message: 'Failed to place order' })
  }
})

module.exports = router
