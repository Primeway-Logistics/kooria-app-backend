require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
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

// ==========================================
// 1. NETWORK STATUS & PUBLIC TRACKING
// ==========================================

// Health & Splash Screen Network Status (Lagos Corridor Instant Network)
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: "online", 
    service: "Kooria Express API v3.4.1",
    network: "Lagos Corridor Instant Network",
    active_riders_online: 420,
    pickup_sla_minutes: 20
  });
});

// Public Quick Track by Waybill Code (No login required - Login Screen)
app.get('/api/v1/orders/track/:waybill', async (req, res) => {
  const waybill = req.params.waybill.replace('#', '').toUpperCase();

  const { data: orderData, error } = await supabase
    .from('orders')
    .select('id, waybill_number, status, pickup_address, destination_address, destination_landmark, eta_minutes, distance_km, package_weight, content_type, milestones, created_at, completed_at, rider_id')
    .ilike('waybill_number', `%${waybill}%`);

  if (error || !orderData || orderData.length === 0) {
    return res.status(404).json({ error: "Waybill not found. Please check your tracking reference." });
  }

  const order = orderData[0];
  let rider = null;

  if (order.rider_id) {
    const { data: riderProfile } = await supabase
      .from('profiles')
      .select('full_name, phone_number, avatar_url, vehicle_model, plate_number, rating, total_trips, current_lat, current_lng, current_speed, updated_at')
      .eq('id', order.rider_id);
    if (riderProfile && riderProfile.length > 0) rider = riderProfile[0];
  }

  res.status(200).json({ message: "Waybill tracking retrieved", order, rider });
});

// ==========================================
// 2. USER PROFILE, ACCOUNT STATS & SETTINGS
// ==========================================

// Get My Profile + Account Dashboard Stats (Total Orders, CO2 Saved, Gold Tier)
app.get('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  let { data: profileData, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId);

  if (error) return res.status(400).json({ error: error.message });

  if (!profileData || profileData.length === 0) {
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert([{ 
        id: userId, 
        email: req.user.email,
        full_name: req.user.user_metadata?.full_name || '',
        phone_number: req.user.user_metadata?.phone_number || '',
        avatar_url: req.user.user_metadata?.avatar_url || ''
      }])
      .select();

    if (createError) return res.status(400).json({ error: createError.message });
    profileData = newProfile;
  }

  // Calculate live metrics for Account Screen
  const { data: userOrders } = await supabase
    .from('orders')
    .select('id, status, distance_km')
    .eq('customer_id', userId);

  const totalOrders = userOrders ? userOrders.length : 0;
  const completedOrders = userOrders ? userOrders.filter(o => o.status === 'delivered') : [];
  const totalDistance = completedOrders.reduce((sum, o) => sum + Number(o.distance_km || 10), 0);
  const co2SavedKg = Number((totalDistance * 0.08).toFixed(1)); // Express Moto CO2 offset calculation
  const membershipTier = completedOrders.length >= 20 ? 'Gold' : 'Standard';

  // Fetch default pickup address
  const { data: defaultAddress } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true);

  res.status(200).json({ 
    message: "Profile and stats retrieved", 
    profile: {
      ...profileData[0],
      tier: membershipTier,
      stats: {
        total_orders: totalOrders,
        completed_shipments: completedOrders.length,
        safedrop_score: Number(profileData[0].safedrop_score || 4.9),
        co2_saved_kg: co2SavedKg
      },
      default_pickup_address: defaultAddress?.[0] || null
    }
  });
});

// Update My Profile & App Preferences (Language, Notifications, 2FA, Role)
app.patch('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const updates = { ...req.body, id: userId, updated_at: new Date() };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(updates)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Profile and preferences updated", profile: data[0] });
});

// Reset / Set Custom 4-Digit SafeDrop Handover PIN (Account Screen)
app.post('/api/v1/users/me/safedrop-pin', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { pin } = req.body;

  if (!pin || pin.toString().length !== 4) {
    return res.status(400).json({ error: "Please provide a valid 4-digit PIN." });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ safedrop_pin: pin.toString(), updated_at: new Date() })
    .eq('id', userId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "SafeDrop 4-Digit Handover PIN updated successfully", safedrop_pin: data[0].safedrop_pin });
});

// Update Rider Live GPS Location & Speed (Rider App)
app.patch('/api/v1/riders/location', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { latitude, longitude, speed_kmh } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: "latitude and longitude are required." });
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ 
      id: riderId, 
      current_lat: Number(latitude), 
      current_lng: Number(longitude),
      current_speed: speed_kmh !== undefined ? Number(speed_kmh) : 32,
      updated_at: new Date()
    })
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ 
    message: "Location updated", 
    location: { 
      latitude: data[0].current_lat, 
      longitude: data[0].current_lng,
      speed_kmh: data[0].current_speed
    } 
  });
});

// ==========================================
// 3. ADDRESS BOOK ENDPOINTS (DISPATCH HUB)
// ==========================================

// Get Saved Addresses (Supports ?category=Personal|Business|Hub & ?search=...)
app.get('/api/v1/addresses', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { category, search } = req.query;

  let query = supabase
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (category && category !== 'All Locations') {
    query = query.eq('category', category);
  }

  if (search) {
    query = query.or(`label.ilike.%${search}%,street_address.ilike.%${search}%,landmark.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({ message: "Addresses retrieved", count: data.length, addresses: data });
});

// Add New Saved Address
app.post('/api/v1/addresses', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { 
    label, category, area, street_address, latitude, longitude, 
    landmark, rider_note, contact_name, contact_phone, is_default 
  } = req.body;

  if (!label || !street_address) {
    return res.status(400).json({ error: "label and street_address are required." });
  }

  if (is_default) {
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', userId);
  }

  const { data, error } = await supabase
    .from('addresses')
    .insert([{
      user_id: userId,
      label,
      category: category || 'Personal',
      area,
      street_address,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      landmark,
      rider_note,
      contact_name,
      contact_phone,
      is_default: Boolean(is_default)
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: "Address saved to Dispatch Hub", address: data[0] });
});

// Edit Saved Address
app.patch('/api/v1/addresses/:id', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const addressId = req.params.id;

  if (req.body.is_default) {
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', userId);
  }

  const { data, error } = await supabase
    .from('addresses')
    .update(req.body)
    .eq('id', addressId)
    .eq('user_id', userId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Address updated", address: data[0] });
});

// Delete Saved Address
app.delete('/api/v1/addresses/:id', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const addressId = req.params.id;

  const { error } = await supabase
    .from('addresses')
    .delete()
    .eq('id', addressId)
    .eq('user_id', userId);

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Address deleted successfully" });
});

// ==========================================
// 4. ORDER & DISPATCH ENDPOINTS
// ==========================================

// Estimate Fare & ETA Calculator (Step 2 of 2: "Get Price & Review Order")
app.post('/api/v1/orders/estimate', authenticateUser, async (req, res) => {
  const { pickup_lat, pickup_lng, destination_lat, destination_lng } = req.body;

  // Haversine distance calculation (defaults to 14.2km if coordinates aren't provided)
  let distanceKm = 14.2;
  if (pickup_lat && pickup_lng && destination_lat && destination_lng) {
    const R = 6371;
    const dLat = (destination_lat - pickup_lat) * (Math.PI / 180);
    const dLng = (destination_lng - pickup_lng) * (Math.PI / 180);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(pickup_lat * (Math.PI / 180)) * Math.cos(destination_lat * (Math.PI / 180)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distanceKm = Number((R * c * 1.3).toFixed(1)); // 1.3x Lagos road factor
  }

  const baseFare = 1000;
  const perKmRate = 100;
  const estimatedPrice = Math.max(1500, Math.round((baseFare + distanceKm * perKmRate) / 100) * 100);
  const estimatedMins = Math.max(20, Math.round(distanceKm * 2.8));

  res.status(200).json({
    message: "Fare estimated successfully",
    estimate: {
      distance_km: distanceKm,
      estimated_fare: estimatedPrice,
      eta_range: `${estimatedMins}-${estimatedMins + 10} mins`,
      eta_minutes: estimatedMins,
      currency: "NGN"
    }
  });
});

// Create Order (Step 1 & Step 2 Complete Payload)
app.post('/api/v1/orders', authenticateUser, async (req, res) => {
  const customer_id = req.user.id;
  const { 
    pickup_address, pickup_lat, pickup_lng, pickup_landmark, sender_name, sender_phone,
    destination_address, destination_lat, destination_lng, destination_landmark, 
    gate_instructions, recipient_name, recipient_phone, rider_directives,
    package_weight, content_type, distance_km, price 
  } = req.body;

  const orderPrice = Number(price);

  if (!pickup_address || !destination_address || !orderPrice || orderPrice <= 0) {
    return res.status(400).json({ error: "Valid pickup_address, destination_address, and price are required." });
  }

  // 1. Check customer wallet
  const { data: walletData, error: walletError } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', customer_id);

  if (walletError || !walletData || walletData.length === 0) {
    return res.status(400).json({ error: "Wallet not found. Please fund your wallet first." });
  }

  const currentBalance = Number(walletData[0].balance);
  if (currentBalance < orderPrice) {
    return res.status(400).json({ error: "Insufficient funds. Please top up your wallet." });
  }

  // 2. Deduct price from wallet
  const newBalance = currentBalance - orderPrice;
  const { error: deductError } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', customer_id);

  if (deductError) return res.status(400).json({ error: "Failed to process wallet payment." });

  // 3. Check if user has a custom SafeDrop PIN, otherwise generate random 4-digit PIN
  const { data: profileData } = await supabase.from('profiles').select('safedrop_pin, full_name, phone_number').eq('id', customer_id);
  const delivery_pin = profileData?.[0]?.safedrop_pin || Math.floor(1000 + Math.random() * 9000).toString();
  const waybill_number = `KR-${Math.floor(10000 + Math.random() * 90000)}`;

  const initialMilestones = [
    {
      stage: 1,
      key: "order_created",
      title: "Order Created & Confirmed",
      description: "Merchant dispatch request accepted by system",
      timestamp: new Date().toISOString()
    }
  ];

  // 4. Create the order
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([
      { 
        waybill_number,
        customer_id, 
        pickup_address,
        pickup_lat: pickup_lat ? Number(pickup_lat) : null,
        pickup_lng: pickup_lng ? Number(pickup_lng) : null,
        pickup_landmark,
        sender_name: sender_name || profileData?.[0]?.full_name || 'Sender',
        sender_phone: sender_phone || profileData?.[0]?.phone_number || '',
        destination_address, 
        destination_lat: destination_lat ? Number(destination_lat) : null,
        destination_lng: destination_lng ? Number(destination_lng) : null,
        destination_landmark,
        gate_instructions,
        recipient_name,
        recipient_phone,
        rider_directives: rider_directives || [],
        package_weight: package_weight || '1.8 kg (Medium)',
        content_type: content_type || 'Electronics & Docs',
        distance_km: distance_km ? Number(distance_km) : 14.2,
        price: orderPrice, 
        status: 'pending',
        delivery_pin,
        milestones: initialMilestones
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

// Fetch Available Orders (Rider App)
app.get('/api/v1/orders/available', authenticateUser, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, waybill_number, customer_id, pickup_address, pickup_lat, pickup_lng, pickup_landmark, destination_address, destination_lat, destination_lng, destination_landmark, price, distance_km, package_weight, content_type, rider_directives, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Available orders fetched successfully", orders: data });
});

// Get Customer Home & Order History (Includes Active Shipment & Recent Deliveries)
app.get('/api/v1/orders/me', authenticateUser, async (req, res) => {
  const customer_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const activeStatuses = ['pending', 'active', 'picked_up', 'in_transit', 'out_for_delivery'];
  const activeShipment = data.find(o => activeStatuses.includes(o.status)) || null;

  res.status(200).json({ 
    message: "Customer orders fetched", 
    active_shipment: activeShipment,
    orders: data 
  });
});

// Get Rider Delivery History
app.get('/api/v1/orders/rider-history', authenticateUser, async (req, res) => {
  const rider_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('rider_id', rider_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Rider delivery history fetched", orders: data });
});

// Get Single Order, Live Radar & SafeDrop Certificate Data
app.get('/api/v1/orders/:id', authenticateUser, async (req, res) => {
  const orderId = req.params.id;

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId);

  if (orderError || !orderData || orderData.length === 0) {
    return res.status(404).json({ error: "Order not found." });
  }

  const order = orderData[0];

  // Hide delivery_pin if viewer is not the customer who created the order
  if (order.customer_id !== req.user.id) {
    delete order.delivery_pin;
  }

  let riderInfo = null;
  if (order.rider_id) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, phone_number, avatar_url, vehicle_model, plate_number, rating, total_trips, current_lat, current_lng, current_speed, updated_at')
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

// Accept Order (Rider - Stage 2: Rider Dispatched)
app.patch('/api/v1/orders/:id/accept', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;

  const { data: existingOrder } = await supabase
    .from('orders')
    .select('milestones')
    .eq('id', orderId)
    .eq('status', 'pending');

  if (!existingOrder || existingOrder.length === 0) {
    return res.status(400).json({ error: "Order not found or already accepted." });
  }

  const { data: riderProfile } = await supabase.from('profiles').select('full_name').eq('id', rider_id);
  const riderName = riderProfile?.[0]?.full_name || 'Dispatch Rider';

  const updatedMilestones = [
    ...(existingOrder[0].milestones || []),
    {
      stage: 2,
      key: "rider_dispatched",
      title: "Rider Dispatched",
      description: `${riderName} assigned to delivery`,
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({ 
      status: 'active', 
      rider_id: rider_id,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .eq('status', 'pending')
    .select();

  if (error) return res.status(400).json({ error: error.message });
  delete data[0].delivery_pin;

  res.status(200).json({ message: "Order accepted successfully", order: data[0] });
});

// Update Order Shipment Milestone (Rider - Stages 3, 4, 5, or Failed)
app.patch('/api/v1/orders/:id/milestone', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const { status, title, description, eta_minutes, failure_reason } = req.body;
  // Allowed status values: 'picked_up', 'in_transit', 'out_for_delivery', 'failed'

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('rider_id', rider_id);

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Order not found or not assigned to you." });
  }

  const stageMap = { picked_up: 3, in_transit: 4, out_for_delivery: 5, failed: 0 };
  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: stageMap[status] || 3,
      key: status,
      title: title || `Status updated to ${status}`,
      description: description || failure_reason || '',
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      eta_minutes: eta_minutes !== undefined ? Number(eta_minutes) : orderData[0].eta_minutes,
      failure_reason: failure_reason || null,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  delete data[0].delivery_pin;

  res.status(200).json({ message: "Shipment milestone updated", order: data[0] });
});

// Reschedule a Failed Order (Customer Home Screen: "Require re-attempt today? Reschedule")
app.patch('/api/v1/orders/:id/reschedule', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const customer_id = req.user.id;
  const { gate_instructions, recipient_phone } = req.body;

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('customer_id', customer_id)
    .eq('status', 'failed');

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Only failed orders belonging to you can be rescheduled." });
  }

  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: 1,
      key: "rescheduled",
      title: "Delivery Rescheduled",
      description: "Customer requested re-attempt dispatch",
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'pending',
      rider_id: null,
      failure_reason: null,
      gate_instructions: gate_instructions || orderData[0].gate_instructions,
      recipient_phone: recipient_phone || orderData[0].recipient_phone,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Order rescheduled for immediate dispatch", order: data[0] });
});

// Cancel Order (Customer - Refunds Wallet if still Pending)
app.patch('/api/v1/orders/:id/cancel', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const customer_id = req.user.id;

  const { data: orderData, error: findError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('customer_id', customer_id)
    .eq('status', 'pending');

  if (findError || !orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Order cannot be canceled (not found, not yours, or already accepted by a rider)." });
  }

  const refundAmount = Number(orderData[0].price);

  const { data: updatedOrder, error: cancelError } = await supabase
    .from('orders')
    .update({ status: 'canceled' })
    .eq('id', orderId)
    .select();

  if (cancelError) return res.status(400).json({ error: cancelError.message });

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

// Complete Order (Rider - SafeDrop PIN Auth, GPS Lock, Photo Proof & Rider Wallet Payout)
app.patch('/api/v1/orders/:id/complete', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const { pin, pod_photo_url, pod_lat, pod_lng } = req.body;

  if (!pin) {
    return res.status(400).json({ error: "Delivery PIN is required to complete this order." });
  }

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('rider_id', rider_id);

  if (orderError || !orderData || orderData.length === 0 || orderData[0].status === 'delivered') {
    return res.status(400).json({ error: "Active order not found or assigned to a different rider." });
  }

  if (orderData[0].delivery_pin !== pin.toString()) {
    return res.status(400).json({ error: "Incorrect Delivery PIN. Please check with the customer." });
  }

  const orderPrice = Number(orderData[0].price);
  const completedAt = new Date().toISOString();

  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: 6,
      key: "delivered",
      title: "Package Delivered",
      description: `Recipient verified with 4-digit PIN [${pin}]`,
      timestamp: completedAt
    }
  ];

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({ 
      status: 'delivered',
      pod_photo_url: pod_photo_url || null,
      pod_lat: pod_lat ? Number(pod_lat) : 6.4474,
      pod_lng: pod_lng ? Number(pod_lng) : 3.4723,
      completed_at: completedAt,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (updateError) return res.status(400).json({ error: "Failed to complete the order." });

  // Deposit earnings into rider's wallet
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
    message: "SafeDrop Certified: Order delivered and earnings deposited", 
    order: updatedOrder[0],
    rider_earnings: orderPrice,
    new_wallet_balance: newBalance
  });
});

// Rate & Tip Rider on SafeDrop Completion Screen (+500 Tip / +1,000 Tip & 1-5 Stars)
app.post('/api/v1/orders/:id/rate-and-tip', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const customer_id = req.user.id;
  const { rating, feedback, tip_amount } = req.body;
  const tip = Number(tip_amount || 0);

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('customer_id', customer_id)
    .eq('status', 'delivered');

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Completed order not found." });
  }

  const order = orderData[0];

  // Process tip from customer wallet to rider wallet if tip > 0
  if (tip > 0) {
    const { data: custWallet } = await supabase.from('wallets').select('balance').eq('user_id', customer_id);
    if (!custWallet || custWallet.length === 0 || Number(custWallet[0].balance) < tip) {
      return res.status(400).json({ error: "Insufficient wallet balance for tip." });
    }

    await supabase
      .from('wallets')
      .update({ balance: Number(custWallet[0].balance) - tip })
      .eq('user_id', customer_id);

    if (order.rider_id) {
      const { data: riderWallet } = await supabase.from('wallets').select('balance').eq('user_id', order.rider_id);
      const newRiderBal = (Number(riderWallet?.[0]?.balance) || 0) + tip;
      await supabase.from('wallets').upsert({ user_id: order.rider_id, balance: newRiderBal });
    }
  }

  const { data: updatedOrder, error } = await supabase
    .from('orders')
    .update({
      rider_rating: rating ? Number(rating) : order.rider_rating,
      rider_feedback: feedback || order.rider_feedback,
      tip_amount: Number(order.tip_amount || 0) + tip
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({
    message: "Feedback and tip submitted successfully",
    order: updatedOrder[0]
  });
});

// ==========================================
// 5. WALLET & SAVED CARDS ENDPOINTS
// ==========================================

// Get Wallet Balance & Saved Bank Cards (Account & Wallet Screen)
app.get('/api/v1/wallet/balance', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  let { data: walletData, error } = await supabase.from('wallets').select('*').eq('user_id', userId);
  if (error) return res.status(400).json({ error: error.message });

  if (!walletData || walletData.length === 0) {
    const { data: newWallet, error: createError } = await supabase
      .from('wallets')
      .insert([{ user_id: userId, balance: 0 }])
      .select();
      
    if (createError) return res.status(400).json({ error: createError.message });
    walletData = newWallet;
  }

  const { data: cards } = await supabase
    .from('saved_cards')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  res.status(200).json({ 
    message: "Wallet retrieved", 
    wallet: walletData[0],
    saved_cards: cards || []
  });
});

// Fund Wallet (Instant Top Up)
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

// Add a Saved Bank Card (Account Screen: GTBank / Access Bank)
app.post('/api/v1/wallet/cards', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { bank_name, card_brand, last4, exp_month, exp_year, is_default } = req.body;

  if (!bank_name || !last4 || !exp_month || !exp_year) {
    return res.status(400).json({ error: "bank_name, last4, exp_month, and exp_year are required." });
  }

  if (is_default) {
    await supabase.from('saved_cards').update({ is_default: false }).eq('user_id', userId);
  }

  const { data, error } = await supabase
    .from('saved_cards')
    .insert([{
      user_id: userId,
      bank_name,
      card_brand: card_brand || 'Mastercard Debit',
      last4: last4.toString(),
      exp_month: exp_month.toString(),
      exp_year: exp_year.toString(),
      is_default: Boolean(is_default)
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: "Card saved successfully", card: data[0] });
});

// Withdraw Funds (Rider Cashout)
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

  if (walletError || !walletData || walletData.length === 0) {
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

// ==========================================
// 6. DISPUTE & DELIVERY ISSUE SUPPORT
// ==========================================

// Report Delivery Issue / Dispute & Lost Goods Claim Center
app.post('/api/v1/support/tickets', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { order_id, waybill_number, issue_type, description } = req.body;

  if (!issue_type || !description) {
    return res.status(400).json({ error: "issue_type and description are required." });
  }

  const { data, error } = await supabase
    .from('support_tickets')
    .insert([{
      user_id: userId,
      order_id: order_id || null,
      waybill_number: waybill_number || null,
      issue_type,
      description
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ 
    message: "Support ticket logged with 24/7 Lagos Dispatch Support", 
    ticket: data[0] 
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Kooria Express backend is running on http://localhost:${PORT}`);
  console.log('Supabase successfully connected!');
});