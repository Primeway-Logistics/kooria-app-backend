require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json()); // Allows your server to read JSON data

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Security Bouncer (Auth Middleware)
const authenticateUser = async (req, res, next) => {
  // 1. Look for the token in the request headers
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  // 2. Ask Supabase if this token is real and currently logged in
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  // 3. Attach the verified user to the request and let them through
  req.user = user; 
  next(); 
};

// Create Order Endpoint (Secured)
app.post('/api/v1/orders', authenticateUser, async (req, res) => {
  const { pickup_address, destination_address, price } = req.body;
  const customer_id = req.user.id; // Automatically grabbed from the secure token

  const { data, error } = await supabase
    .from('orders')
    .insert([
      { 
        customer_id, // Save who placed the order
        pickup_address, 
        destination_address, 
        price, 
        status: 'pending' 
      }
    ])
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  res.status(201).json({ message: "Order created successfully", order: data });
});

// Fetch Available Orders Endpoint (For Riders)
app.get('/api/v1/orders/available', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('status', 'pending');

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  res.status(200).json({ message: "Available orders fetched successfully", orders: data });
});

// Accept Order Endpoint (For Riders)
app.patch('/api/v1/orders/:id/accept', async (req, res) => {
  const orderId = req.params.id;
  const { rider_id } = req.body; // Extract the rider's ID from the frontend request

  // Safety check: ensure the frontend actually sent a rider ID
  if (!rider_id) {
    return res.status(400).json({ error: "rider_id is required to accept an order." });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ 
      status: 'active', 
      rider_id: rider_id // Save which rider took the job
    })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  if (data.length === 0) {
    return res.status(400).json({ error: "Order not found or already accepted." });
  }
  
  res.status(200).json({ message: "Order accepted successfully", order: data[0] });
});

// Complete Order Endpoint (For Riders)
app.patch('/api/v1/orders/:id/complete', async (req, res) => {
  const orderId = req.params.id;
  const { rider_id } = req.body; 

  if (!rider_id) {
    return res.status(400).json({ error: "rider_id is required to complete an order." });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'delivered' }) 
    .eq('id', orderId)
    .eq('status', 'active')    // Safety check: must be an active delivery
    .eq('rider_id', rider_id)  // Safety check: must be the rider who accepted it
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  if (data.length === 0) {
    return res.status(400).json({ error: "Order not found, not active, or assigned to a different rider." });
  }
  
  res.status(200).json({ message: "Order delivered successfully", order: data[0] });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Kooria Express backend is running on http://localhost:${PORT}`);
  console.log('Supabase successfully connected!');
});