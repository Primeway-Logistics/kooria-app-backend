require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ==========================================
// SECURITY BOUNCER (AUTH MIDDLEWARE)
// ==========================================
const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  req.user = user; 
  next(); 
};

// Health Check Endpoint (For cloud deployment monitoring)
app.get('/', (req, res) => {
  res.status(200).json({ status: "online", service: "Kooria Express API" });
});

// ==========================================
// USER PROFILE & GPS ENDPOINTS
// ==========================================

// 1. Get My Profile (Auto-creates profile if first login)
app.get('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId);

  if (error) return res.status(400).json({ error: error.message });

  if (data.length === 0) {
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert([{ 
        id: userId, 
        full_name: req.user.user_metadata?.full_name || '',
        avatar_url: req.user.user_metadata?.avatar_url || ''
      }])
      .select();

    if (createError) return res.status(400).json({ error: createError.message });
    return res.status(200).json({ message: "Profile retrieved", profile: newProfile[0] });
  }

  res.status(200).json({ message: "Profile retrieved", profile: data[0] });
});

// 2. Update My Profile (Name, Phone Number, Role, Avatar)
app.patch('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { full_name, phone_number, role, avatar_url } = req.body;

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ 
      id: userId, 
      full_name, 
      phone_number, 
      role, 
      avatar_url,
      updated_at: new Date()
    })
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Profile updated successfully", profile: data[0] });
});

// 3. Update Rider Live GPS Location
app.patch('/api/v1/riders/location', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { latitude, longitude } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: "latitude and longitude are required." });
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ 
      id: riderId, 
      current_lat: Number(latitude), 
      current_lng: Number(longitude),
      updated_at: new Date()
    })
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Location updated", location: { latitude: data[0].current_lat, longitude: data[0].current_lng } });
});

// ==========================================
// ORDER ENDPOINTS
// ==========================================

// 4. Create Order (Customer - Deducts Wallet & Generates PIN)
app.post('/api/v1/orders', authenticateUser, async (req, res) => {
  const { pickup_address, destination_address, price } = req.body;
  const customer_id = req.user.id;
  const orderPrice = Number(price);

  if (!pickup_address || !destination_address || !orderPrice || orderPrice <= 0) {
    return res.status(400).json({ error: "Valid pickup_address, destination_address, and price are required." });
  }

  // Check customer wallet
  const { data: walletData, error: walletError } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', customer_id);

  if (walletError || walletData.length === 0) {
    return res.status(400).json({ error: "Wallet not found. Please fund your wallet first." });
  }

  const currentBalance = Number(walletData[0].balance);

  if (currentBalance < orderPrice) {
    return res.status(400).json({ error: "Insufficient funds. Please top up your wallet." });
  }

  // Deduct price from wallet
  const newBalance = currentBalance - orderPrice;
  const { error: deductError } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', customer_id);

  if (deductError) {
    return res.status(400).json({ error: "Failed to process payment." });
  }

  // Generate 4-digit PIN and create order
  const delivery_pin = Math.floor(1000 + Math.random() * 9000).toString();

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([
      { 
        customer_id, 
        pickup_address, 
        destination_address, 
        price: orderPrice, 
        status: 'pending',
        delivery_pin
      }
    ])
    .select();

  // Safety refund if order creation fails
  if (orderError) {
    await supabase.from('wallets').update({ balance: currentBalance }).eq('user_id', customer_id);
    return res.status(400).json({ error: orderError.message });
  }
  
  res.status(201).json({ 
    message: "Order created and payment deducted successfully", 
    order: orderData[0],
    remaining_balance: newBalance
  });
});

// 5. Fetch Available Orders (Rider)
app.get('/api/v1/orders/available', authenticateUser, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, pickup_address, destination_address, price, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Available orders fetched successfully", orders: data });
});

// 6. Get Customer Order History
app.get('/api/v1/orders/me', authenticateUser, async (req, res) => {
  const customer_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Customer order history fetched", orders: data });
});

// 7. Get Rider Delivery History
app.get('/api/v1/orders/rider-history', authenticateUser, async (req, res) => {
  const rider_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, rider_id, pickup_address, destination_address, price, status, created_at')
    .eq('rider_id', rider_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Rider delivery history fetched", orders: data });
});

// 8. Get Single Order & Live Rider Location (For Live Map Tracking)
app.get('/api/v1/orders/:id', authenticateUser, async (req, res) => {
  const orderId = req.params.id;

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId);

  if (orderError || orderData.length === 0) {
    return res.status(404).json({ error: "Order not found." });
  }

  const order = orderData[0];

  // Hide delivery_pin if the viewer is not the customer who placed the order
  if (order.customer_id !== req.user.id) {
    delete order.delivery_pin;
  }

  let riderInfo = null;
  if (order.rider_id) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, phone_number, avatar_url, current_lat, current_lng, updated_at')
      .eq('id', order.rider_id);
    
    if (profileData && profileData.length > 0) {
      riderInfo = profileData[0];
    }
  }

  res.status(200).json({ 
    message: "Order details fetched", 
    order, 
    rider: riderInfo 
  });
});

// 9. Accept Order (Rider)
app.patch('/api/v1/orders/:id/accept', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .update({ 
      status: 'active', 
      rider_id: rider_id 
    })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select('id, customer_id, rider_id, pickup_address, destination_address, price, status, created_at');

  if (error) return res.status(400).json({ error: error.message });
  if (data.length === 0) return res.status(400).json({ error: "Order not found or already accepted." });
  
  res.status(200).json({ message: "Order accepted successfully", order: data[0] });
});

// 10. Cancel Order (Customer - Refunds Wallet if still Pending)
app.patch('/api/v1/orders/:id/cancel', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const customer_id = req.user.id;

  // Verify order is still pending and belongs to customer
  const { data: orderData, error: findError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('customer_id', customer_id)
    .eq('status', 'pending');

  if (findError || orderData.length === 0) {
    return res.status(400).json({ error: "Order cannot be canceled (not found, not yours, or already accepted by a rider)." });
  }

  const refundAmount = Number(orderData[0].price);

  // Update status to canceled
  const { data: updatedOrder, error: cancelError } = await supabase
    .from('orders')
    .update({ status: 'canceled' })
    .eq('id', orderId)
    .select();

  if (cancelError) return res.status(400).json({ error: cancelError.message });

  // Refund customer's wallet
  const { data: walletData } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', customer_id);

  let newBalance = refundAmount;
  if (walletData && walletData.length > 0) {
    newBalance += Number(walletData[0].balance);
    await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', customer_id);
  }

  res.status(200).json({ 
    message: "Order canceled and payment refunded to wallet", 
    order: updatedOrder[0],
    refunded_amount: refundAmount,
    new_wallet_balance: newBalance
  });
});

// 11. Complete Order (Rider - Verifies PIN & Pays Rider Wallet)
app.patch('/api/v1/orders/:id/complete', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: "Delivery PIN is required to complete this order." });
  }

  // 1. Find the active order and get its price & PIN
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('status', 'active')
    .eq('rider_id', rider_id);

  if (orderError || orderData.length === 0) {
    return res.status(400).json({ error: "Order not found, not active, or assigned to a different rider." });
  }

  // 2. Verify the PIN
  if (orderData[0].delivery_pin !== pin.toString()) {
    return res.status(400).json({ error: "Incorrect Delivery PIN. Please check with the customer." });
  }

  const orderPrice = Number(orderData[0].price);

  // 3. Mark the order as delivered
  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'delivered' })
    .eq('id', orderId);

  if (updateError) {
    return res.status(400).json({ error: "Failed to complete the order." });
  }

  // 4. Check the rider's wallet & deposit earnings
  const { data: walletData } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', rider_id);

  let newBalance = orderPrice;

  if (!walletData || walletData.length === 0) {
    await supabase.from('wallets').insert([{ user_id: rider_id, balance: newBalance }]);
  } else {
    newBalance += Number(walletData[0].balance);
    await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', rider_id);
  }

  res.status(200).json({ 
    message: "Order delivered and earnings deposited", 
    order: { ...orderData[0], status: 'delivered' },
    rider_earnings: orderPrice,
    new_wallet_balance: newBalance
  });
});

// ==========================================
// WALLET ENDPOINTS
// ==========================================

// 12. Get Wallet Balance
app.get('/api/v1/wallet/balance', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId);
  if (error) return res.status(400).json({ error: error.message });

  if (data.length === 0) {
    const { data: newWallet, error: createError } = await supabase
      .from('wallets')
      .insert([{ user_id: userId, balance: 0 }])
      .select();
      
    if (createError) return res.status(400).json({ error: createError.message });
    return res.status(200).json({ message: "Wallet retrieved", wallet: newWallet[0] });
  }

  res.status(200).json({ message: "Wallet retrieved", wallet: data[0] });
});

// 13. Fund Wallet
app.post('/api/v1/wallet/fund', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Please provide a valid amount." });
  }

  const { data: existingWallet } = await supabase.from('wallets').select('*').eq('user_id', userId);

  let responseData, responseError;

  if (!existingWallet || existingWallet.length === 0) {
    const { data, error } = await supabase
      .from('wallets')
      .insert([{ user_id: userId, balance: Number(amount) }])
      .select();
    responseData = data; responseError = error;
  } else {
    const newBalance = Number(existingWallet[0].balance) + Number(amount);
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('user_id', userId)
      .select();
    responseData = data; responseError = error;
  }

  if (responseError) return res.status(400).json({ error: responseError.message });
  res.status(200).json({ message: "Wallet funded successfully", wallet: responseData[0] });
});

// 14. Withdraw Funds (Rider Cashout)
app.post('/api/v1/wallet/withdraw', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { amount, bank_name, account_number } = req.body;
  const withdrawAmount = Number(amount);

  if (!withdrawAmount || withdrawAmount <= 0 || !bank_name || !account_number) {
    return res.status(400).json({ error: "Valid amount, bank_name, and account_number are required." });
  }

  const { data: walletData, error: walletError } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId);

  if (walletError || walletData.length === 0) {
    return res.status(400).json({ error: "Wallet not found." });
  }

  const currentBalance = Number(walletData[0].balance);
  if (currentBalance < withdrawAmount) {
    return res.status(400).json({ error: "Insufficient wallet balance for withdrawal." });
  }

  const newBalance = currentBalance - withdrawAmount;
  const { data: updatedWallet, error: updateError } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', userId)
    .select();

  if (updateError) return res.status(400).json({ error: updateError.message });

  res.status(200).json({ 
    message: "Withdrawal processed successfully", 
    withdrawn_amount: withdrawAmount,
    destination: `${bank_name} - ${account_number}`,
    wallet: updatedWallet[0] 
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Kooria Express backend is running on http://localhost:${PORT}`);
  console.log('Supabase successfully connected!');
});