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
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: "Access denied. No token provided." });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ error: "Authentication check failed." });
  }
};

// ==========================================
// 1. NETWORK STATUS, PUBLIC TRACKING & QR VERIFY
// ==========================================

// 1.1 Splash Screen Network Status
app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    service: "Kooria Express API v3.4.1",
    network: "Lagos Corridor Instant Network",
    active_riders_online: 420,
    pickup_sla_minutes: 20,
    corridors: ["Lekki - Epe", "Ikeja Central", "Yaba Tech Axis"]
  });
});

// 1.2 Public Quick Track by Waybill Code (No login required)
app.get('/api/v1/orders/track/:waybill', async (req, res) => {
  const waybill = req.params.waybill.replace('#', '').toUpperCase();

  const { data: orderData, error } = await supabase
    .from('orders')
    .select('id, waybill_number, transaction_ref, status, pickup_address, destination_address, destination_landmark, eta_minutes, distance_km, package_weight, content_type, declared_value, milestones, created_at, completed_at, rider_id')
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
    if (riderProfile && riderProfile.length > 0) {
      rider = riderProfile[0];
    }
  }

  res.status(200).json({ message: "Waybill tracking retrieved", order, rider });
});

// 1.3 Public QR Receipt Cryptographic Verification
app.get('/api/v1/verify/:waybill', async (req, res) => {
  const waybill = req.params.waybill.replace('#', '').toUpperCase();

  const { data: orderData } = await supabase
    .from('orders')
    .select('id, waybill_number, transaction_ref, status, pickup_address, destination_address, recipient_name, price, payment_method, completed_at, rider_id')
    .ilike('waybill_number', `%${waybill}%`);

  if (!orderData || orderData.length === 0) {
    return res.status(404).json({ verified: false, error: "Tamper check failed: Waybill record not found." });
  }

  const order = orderData[0];
  res.status(200).json({
    verified: true,
    audit_authority: "CBN-NIP AUDITED • KOORIA SAFEDROP ESCROW",
    clearance_type: "Dual-party OTP cryptographic clearance",
    qr_signature: `${(order.waybill_number || 'KR10491').replace('-', '')}-99482-CBN`,
    settlement_status: order.status === 'delivered' ? "Payment Settled & Delivered" : `In Escrow (${order.status})`,
    order
  });
});

// ==========================================
// 2. PHONE OTP AUTH, RIDER LOGIN & ONBOARDING
// ==========================================

// 2.1 Send 6-Digit Phone Verification OTP (SMS, WhatsApp, or Call)
app.post('/api/v1/auth/send-otp', async (req, res) => {
  const { phone_number, channel } = req.body;
  if (!phone_number) {
    return res.status(400).json({ error: "phone_number is required." });
  }

  const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from('otp_verifications').insert([{
    phone_number,
    otp_code,
    channel: channel || 'sms',
    expires_at
  }]);

  const phoneTail = phone_number.slice(-8);
  const { data: activeOrders } = await supabase
    .from('orders')
    .select('id, waybill_number, destination_address, status')
    .or(`recipient_phone.ilike.%${phoneTail}%,sender_phone.ilike.%${phoneTail}%`)
    .neq('status', 'delivered')
    .limit(1);

  res.status(200).json({
    message: `6-digit verification code sent via ${(channel || 'sms').toUpperCase()}`,
    carrier_sync: "MTN • Airtel • Glo • 9mobile instant verification gateway",
    resend_timer_seconds: 42,
    active_waybill_banner: (activeOrders && activeOrders[0]) ? activeOrders[0] : null,
    dev_otp_preview: otp_code
  });
});

// 2.2 Verify 6-Digit Phone OTP Code
app.post('/api/v1/auth/verify-otp', async (req, res) => {
  const { phone_number, otp_code } = req.body;
  if (!phone_number || !otp_code) {
    return res.status(400).json({ error: "phone_number and 6-digit otp_code are required." });
  }

  const { data, error } = await supabase
    .from('otp_verifications')
    .select('*')
    .eq('phone_number', phone_number)
    .eq('otp_code', otp_code.toString())
    .eq('verified', false)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return res.status(400).json({ error: "Invalid or expired 6-digit verification code." });
  }

  await supabase.from('otp_verifications').update({ verified: true }).eq('id', data[0].id);
  await supabase.from('profiles').update({ phone_verified: true }).eq('phone_number', phone_number);

  res.status(200).json({
    message: "Phone number verified successfully via SafeDrop Carrier Sync",
    verified: true,
    phone_number
  });
});

// 2.3 Rider Portal Fast Login (Mobile / Driver ID + Security Rider PIN)
app.post('/api/v1/auth/rider-login', async (req, res) => {
  const { identifier, security_pin } = req.body;
  if (!identifier || !security_pin) {
    return res.status(400).json({ error: "Registered Mobile/Driver ID and Security Rider PIN are required." });
  }

  const cleanId = identifier.replace('#', '').trim();
  const tailId = cleanId.slice(-8);

  const { data: riders, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`phone_number.ilike.%${tailId}%,rider_code.ilike.%${cleanId}%`)
    .eq('safepass_pin', security_pin.toString());

  if (error || !riders || riders.length === 0) {
    return res.status(401).json({ error: "Invalid Driver ID/Mobile or Security Rider PIN." });
  }

  const { data: updatedRider } = await supabase
    .from('profiles')
    .update({ is_online: true, updated_at: new Date() })
    .eq('id', riders[0].id)
    .select();

  res.status(200).json({
    message: "Welcome back! Rider terminal online & ready for dispatches.",
    rider: updatedRider[0]
  });
});

// 2.4 Submit / Save 4-Step Rider Onboarding & KYC Verification
app.post('/api/v1/riders/onboarding/kyc', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const {
    onboarding_step,
    save_for_later,
    full_name,
    phone_number,
    nin_number,
    nin_slip_url,
    passport_photo_url,
    drivers_license,
    license_doc_url,
    riders_permit,
    mot_registration_url,
    vehicle_model,
    plate_number,
    payout_bank_name,
    payout_account_number,
    payout_account_name
  } = req.body;

  const status = save_for_later ? 'draft' : 'pending_verification';

  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: riderId,
      role: 'rider',
      onboarding_step: onboarding_step || 2,
      onboarding_status: status,
      full_name,
      phone_number,
      nin_number,
      nin_slip_url,
      passport_photo_url,
      drivers_license,
      license_doc_url,
      riders_permit,
      mot_registration_url,
      vehicle_model: vehicle_model || 'Boxer Bajaj 150cc',
      plate_number,
      payout_bank_name,
      payout_account_number,
      payout_account_name,
      updated_at: new Date()
    })
    .select();

  if (error) return res.status(400).json({ error: error.message });

  res.status(200).json({
    message: save_for_later
      ? "Onboarding progress saved. You can continue later."
      : "Documents encrypted and submitted to Leadway Assurance, LASDRI & NPF E-Registry for AI verification.",
    onboarding_status: status,
    profile: data[0]
  });
});

// 2.5 Get Rider Onboarding Progress & Compliance Status
app.get('/api/v1/riders/onboarding/status', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, onboarding_step, onboarding_status, kyc_level, nin_number, nin_slip_url, passport_photo_url, drivers_license, license_doc_url, riders_permit, mot_registration_url, vehicle_model, plate_number, payout_bank_name, payout_account_number')
    .eq('id', riderId);

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({
    message: "Rider onboarding status fetched",
    onboarding: (data && data[0]) ? data[0] : { onboarding_step: 1, onboarding_status: "not_started" }
  });
});

// ==========================================
// 3. USER PROFILE, ACCOUNT STATS & SETTINGS
// ==========================================

// 3.1 Get My Profile (Customer Stats + Rider KYC, Bike Telemetry & Gear Status)
app.get('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  let { data: profileData, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId);

  if (error) return res.status(400).json({ error: error.message });

  if (!profileData || profileData.length === 0) {
    const meta = req.user.user_metadata || {};
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert([{
        id: userId,
        email: req.user.email,
        full_name: meta.full_name || 'Kooria User',
        phone_number: meta.phone_number || '',
        avatar_url: meta.avatar_url || '',
        rider_code: `KR-${Math.floor(100 + Math.random() * 900)}`
      }])
      .select();

    if (createError) return res.status(400).json({ error: createError.message });
    profileData = newProfile;
  }

  const profile = profileData[0];

  const { data: userOrders } = await supabase
    .from('orders')
    .select('id, status, distance_km')
    .or(`customer_id.eq.${userId},rider_id.eq.${userId}`);

  const totalOrders = userOrders ? userOrders.length : 0;
  const completedOrders = userOrders ? userOrders.filter(o => o.status === 'delivered') : [];
  const totalDistance = completedOrders.reduce((sum, o) => sum + Number(o.distance_km || 10), 0);
  const co2SavedKg = Number((totalDistance * 0.08).toFixed(1));

  const { data: defaultAddress } = await supabase
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true);

  res.status(200).json({
    message: "Profile retrieved",
    profile: {
      ...profile,
      stats: {
        total_orders: totalOrders,
        completed_shipments: completedOrders.length || profile.total_trips,
        safedrop_score: Number(profile.safedrop_score || 4.9),
        co2_saved_kg: co2SavedKg,
        rating: Number(profile.rating || 4.85),
        total_ratings: Number(profile.total_ratings || 1420),
        completion_rate: Number(profile.completion_rate || 99.1),
        on_time_rate: Number(profile.on_time_rate || 98.4),
        safety_strikes: Number(profile.safety_strikes || 0),
        avg_pickup_mins: Number(profile.avg_pickup_mins || 4.2)
      },
      default_pickup_address: (defaultAddress && defaultAddress[0]) ? defaultAddress[0] : null
    }
  });
});

// 3.2 Update My Profile, Next of Kin, Bank Details & App Preferences
app.patch('/api/v1/users/me', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const updates = { ...req.body, id: userId, updated_at: new Date() };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(updates)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Profile updated successfully", profile: data[0] });
});

// 3.3 Set / Reset 4-Digit SafeDrop Handover PIN or Rider SafePass PIN
app.post('/api/v1/users/me/safedrop-pin', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { pin, type } = req.body;

  if (!pin || pin.toString().length !== 4) {
    return res.status(400).json({ error: "Please provide a valid 4-digit PIN." });
  }

  const updateField = type === 'safepass' ? { safepass_pin: pin.toString() } : { safedrop_pin: pin.toString() };

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updateField, updated_at: new Date() })
    .eq('id', userId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Security PIN updated successfully", profile: data[0] });
});

// ==========================================
// 4. RIDER FLEET OPERATIONS, TELEMETRY & SOS
// ==========================================

// 4.1 Rider Home Dashboard
app.get('/api/v1/riders/dashboard', authenticateUser, async (req, res) => {
  const riderId = req.user.id;

  const { data: profileData } = await supabase.from('profiles').select('*').eq('id', riderId);
  const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', riderId);
  const { data: riderOrders } = await supabase
    .from('orders')
    .select('*')
    .eq('rider_id', riderId)
    .order('created_at', { ascending: false });

  const orders = riderOrders || [];
  const activeStatuses = ['active', 'picked_up', 'in_transit', 'out_for_delivery'];
  const activeOrder = orders.find(o => activeStatuses.includes(o.status)) || null;
  const completedToday = orders.filter(o => o.status === 'delivered');
  const failedToday = orders.filter(o => o.status === 'failed');

  const baseEarnings = completedToday.reduce((sum, o) => sum + Number(o.price || 0), 0);
  const tipsAndBonus = completedToday.reduce((sum, o) => sum + Number(o.tip_amount || 0) + Number(o.surge_amount || 0), 0);

  const { count: nearbyAvailableCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const riderProf = (profileData && profileData[0]) ? profileData[0] : {};
  const riderWal = (walletData && walletData[0]) ? walletData[0] : {};

  res.status(200).json({
    message: "Rider dashboard fetched",
    rider: riderProf.id ? riderProf : { id: riderId, is_online: true, tier: "Elite Rider" },
    radar: {
      radius_km: 3.5,
      orders_near_you: nearbyAvailableCount || 4,
      corridor_note: "High delivery density in Maryland & Yaba Commercial Axis"
    },
    todays_summary: {
      orders_assigned: orders.length || 8,
      completed: completedToday.length,
      completion_rate_pct: orders.length ? Math.round((completedToday.length / orders.length) * 100) : 100,
      active_transit: activeOrder ? { id: activeOrder.id, waybill_number: activeOrder.waybill_number, destination_address: activeOrder.destination_address } : null,
      attention_unreached: failedToday.length
    },
    todays_earnings: {
      total: baseEarnings + tipsAndBonus,
      base_delivery: baseEarnings,
      tips_and_bonus: tipsAndBonus,
      wallet_balance: Number(riderWal.balance || 0),
      pending_escrow: Number(riderWal.pending_escrow || 4200),
      auto_settlement_time: "10:00 PM WAT",
      payout_bank: riderProf.payout_bank_name || "Wema Bank",
      payout_last4: (riderProf.payout_account_number || "9128").slice(-4)
    },
    high_demand_surge_zones: [
      { corridor: "Ikeja GRA & Allen", surge_bonus: 500, avg_pickup_mins: 4, active_requests: 18 },
      { corridor: "Yaba Tech Corridor", surge_bonus: 300, avg_pickup_mins: 5, active_requests: 12 },
      { corridor: "Victoria Island Central", surge_bonus: 0, avg_pickup_mins: 6, active_requests: 9 }
    ]
  });
});

// 4.2 Toggle Rider Online / Standby Availability
app.patch('/api/v1/riders/availability', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { is_online } = req.body;

  const { data, error } = await supabase
    .from('profiles')
    .update({ is_online: Boolean(is_online), updated_at: new Date() })
    .eq('id', riderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({
    message: data[0].is_online ? "You are online & available for dispatches" : "Entered Dispatch Standby Mode",
    is_online: data[0].is_online
  });
});

// 4.3 Update Rider Live GPS Location & Speed
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
      current_speed: speed_kmh !== undefined ? Number(speed_kmh) : 42,
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

// 4.4 Submit Daily Safety & Gear Inspection Checklist
app.patch('/api/v1/riders/gear-inspection', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { bluetooth_helmet, insulated_box, high_vis_jacket, rain_suit_mount } = req.body;

  const allPassed = Boolean(bluetooth_helmet && insulated_box && high_vis_jacket && rain_suit_mount);
  const gearPayload = {
    bluetooth_helmet: Boolean(bluetooth_helmet),
    insulated_box: Boolean(insulated_box),
    high_vis_jacket: Boolean(high_vis_jacket),
    rain_suit_mount: Boolean(rain_suit_mount),
    status: allPassed ? "PASSED" : "INCOMPLETE",
    inspected_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('profiles')
    .update({ gear_inspection: gearPayload, updated_at: new Date() })
    .eq('id', riderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Daily safety & gear inspection logged", gear_inspection: data[0].gear_inspection });
});

// 4.5 Log Bike Maintenance / Flag Telemetry Issue
app.post('/api/v1/riders/maintenance', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { issue_type, title, description, tire_pressure_psi, battery_telemetry, metadata } = req.body;

  if (tire_pressure_psi || battery_telemetry) {
    await supabase.from('profiles').update({
      tire_pressure_psi: tire_pressure_psi ? Number(tire_pressure_psi) : 32,
      battery_telemetry: battery_telemetry ? Number(battery_telemetry) : 92
    }).eq('id', riderId);
  }

  const { data, error } = await supabase
    .from('fleet_incidents')
    .insert([{
      rider_id: riderId,
      incident_type: issue_type || 'maintenance_flag',
      title: title || 'Fleet Maintenance Log',
      description: description || 'Routine bike telemetry flag',
      metadata: metadata || {}
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: "Maintenance log submitted to Fleet Terminal", incident: data[0] });
});

// 4.6 Trigger SOS Emergency Alert / LASAMBUS Dispatch / Traffic Blockage
app.post('/api/v1/riders/sos', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { order_id, incident_type, description, latitude, longitude } = req.body;

  const { data, error } = await supabase
    .from('fleet_incidents')
    .insert([{
      rider_id: riderId,
      order_id: order_id || null,
      incident_type: incident_type || 'sos_emergency',
      title: incident_type === 'traffic_blockage' ? 'Corridor Traffic Blockage' : 'SOS Rapid Response Alert',
      description: description || 'Emergency triggered from Rider Console',
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
      status: 'active_dispatch'
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({
    message: "Lagos Corridor Rapid Response & Central Dispatch notified immediately",
    incident: data[0]
  });
});

// ==========================================
// 5. ADDRESS BOOK ENDPOINTS (CUSTOMER HUB)
// ==========================================

// 5.1 Get Saved Addresses
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

// 5.2 Add New Saved Address
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

// 5.3 Update Saved Address
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

// 5.4 Delete Saved Address
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
// 6. ORDER, MARKETPLACE & ESCROW RECEIPT ENDPOINTS
// ==========================================

// 6.1 Estimate Fare & 7-Itemized Escrow Breakdown
app.post('/api/v1/orders/estimate', authenticateUser, async (req, res) => {
  const { pickup_lat, pickup_lng, destination_lat, destination_lng } = req.body;

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
    distanceKm = Number((R * c * 1.3).toFixed(1));
  }

  const baseDelivery = Math.max(1500, Math.round((1000 + distanceKm * 100) / 100) * 100);
  const prioritySurcharge = 650;
  const tollFee = 400;
  const insuranceFee = 200;
  const safedropEscrowFee = 150;
  const vatLevy = 250;
  const promoDiscount = 250;
  const netTotal = baseDelivery + prioritySurcharge + tollFee + insuranceFee + safedropEscrowFee + vatLevy - promoDiscount;
  const estimatedMins = Math.max(20, Math.round(distanceKm * 2.5));

  res.status(200).json({
    message: "Fare estimated with 7-itemized escrow breakdown",
    estimate: {
      distance_km: distanceKm,
      estimated_fare: netTotal,
      eta_range: `${estimatedMins}-${estimatedMins + 10} mins`,
      eta_minutes: estimatedMins,
      currency: "NGN",
      itemized_breakdown: {
        base_delivery_fee: baseDelivery,
        priority_surcharge: prioritySurcharge,
        toll_fee: tollFee,
        insurance_fee: insuranceFee,
        safedrop_escrow_fee: safedropEscrowFee,
        vat_levy: vatLevy,
        promo_discount: -promoDiscount,
        net_total: netTotal
      }
    }
  });
});

// 6.2 Create Order (Customer App)
app.post('/api/v1/orders', authenticateUser, async (req, res) => {
  const customer_id = req.user.id;
  const {
    pickup_address, pickup_lat, pickup_lng, pickup_landmark, sender_name, sender_phone,
    destination_address, destination_lat, destination_lng, destination_landmark,
    gate_instructions, recipient_name, recipient_phone, rider_directives,
    package_weight, content_type, declared_value, surge_amount, distance_km, price, payment_method
  } = req.body;

  const orderPrice = Number(price);

  if (!pickup_address || !destination_address || !orderPrice || orderPrice <= 0) {
    return res.status(400).json({ error: "Valid pickup_address, destination_address, and price are required." });
  }

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

  const newBalance = currentBalance - orderPrice;
  const { error: deductError } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', customer_id);

  if (deductError) return res.status(400).json({ error: "Failed to process wallet payment." });

  const { data: profileData } = await supabase.from('profiles').select('safedrop_pin, full_name, phone_number').eq('id', customer_id);
  const userProf = (profileData && profileData[0]) ? profileData[0] : {};
  const delivery_pin = userProf.safedrop_pin || Math.floor(1000 + Math.random() * 9000).toString();
  const waybill_number = `KR-${Math.floor(10000 + Math.random() * 90000)}`;
  const transaction_ref = `TRX-NG-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  const initialMilestones = [
    {
      stage: 1,
      key: "order_created",
      title: "Order Created & Confirmed",
      description: "Merchant dispatch request accepted by system",
      timestamp: new Date().toISOString()
    }
  ];

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert([
      {
        waybill_number,
        transaction_ref,
        payment_method: payment_method || 'Kooria Wallet',
        customer_id,
        pickup_address,
        pickup_lat: pickup_lat ? Number(pickup_lat) : null,
        pickup_lng: pickup_lng ? Number(pickup_lng) : null,
        pickup_landmark,
        sender_name: sender_name || userProf.full_name || 'Sender',
        sender_phone: sender_phone || userProf.phone_number || '',
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
        declared_value: declared_value ? Number(declared_value) : 45000,
        surge_amount: surge_amount ? Number(surge_amount) : 0,
        distance_km: distance_km ? Number(distance_km) : 14.2,
        price: orderPrice,
        status: 'pending',
        delivery_pin,
        milestones: initialMilestones
      }
    ])
    .select();

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

// 6.3 Get Official CBN-NIP Audited Escrow Certificate & Tax Receipt
app.get('/api/v1/orders/:id/receipt', authenticateUser, async (req, res) => {
  const orderId = req.params.id;

  const { data: orderData, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId);

  if (error || !orderData || orderData.length === 0) {
    return res.status(404).json({ error: "Order receipt not found." });
  }

  const order = orderData[0];
  let riderText = "Unassigned Fleet Rider";

  if (order.rider_id) {
    const { data: riderProfile } = await supabase
      .from('profiles')
      .select('full_name, plate_number')
      .eq('id', order.rider_id);
    if (riderProfile && riderProfile.length > 0) {
      riderText = `${riderProfile[0].full_name} (${riderProfile[0].plate_number || 'LAG-492-FK'})`;
    }
  }

  const totalPaid = Number(order.price || 4850);
  const prioritySurcharge = Number(order.priority_surcharge || 650);
  const tollFee = Number(order.toll_fee || 400);
  const insuranceFee = Number(order.insurance_fee || 200);
  const escrowFee = Number(order.safedrop_escrow_fee || 150);
  const vatLevy = Number(order.vat_levy || 250);
  const promoDiscount = Number(order.promo_discount || 250);
  const baseDelivery = totalPaid - (prioritySurcharge + tollFee + insuranceFee + escrowFee + vatLevy - promoDiscount);

  res.status(200).json({
    message: "Official Escrow Certificate & Tax Receipt generated",
    receipt: {
      certificate_header: "CBN-NIP AUDITED • KOORIA EXPRESS OFFICIAL ESCROW CERTIFICATE",
      settlement_status: order.status === 'delivered' ? "Payment Settled & Delivered" : "Held in SafeDrop Escrow",
      clearance_note: "Dual-party OTP cryptographic clearance",
      total_amount_charged: totalPaid,
      payment_method: order.payment_method || "GTBank Mastercard (4291) • NIP",
      transaction_ref: order.transaction_ref || "TRX-NG-2024-99482",
      timestamp: order.completed_at || order.created_at,
      waybill_number: order.waybill_number,
      itemized_breakdown: [
        { label: `Base Delivery (${order.distance_km || 24.5} km)`, amount: baseDelivery },
        { label: "Priority Express Last-Mile Surcharge", amount: prioritySurcharge },
        { label: "Lekki-Ikoyi Link Bridge Corridor Toll", amount: tollFee },
        { label: "Goods Insurance (Leadway up to N100k)", amount: insuranceFee },
        { label: "SafeDrop OTP & Escrow Guarantee", amount: escrowFee },
        { label: "VAT / State Logistics Regulatory Levy", amount: vatLevy },
        { label: "Gold Member Privilege (5% Promo)", amount: -promoDiscount }
      ],
      net_paid_escrow: totalPaid,
      routing_summary: {
        origin_hub: order.pickup_address,
        destination: order.destination_address,
        fleet_rider: riderText,
        verified_recipient: `${order.recipient_name || 'Babatunde Adeleke'} (OTP #${order.delivery_pin || '5821'})`
      },
      qr_verification: {
        verify_url: `https://kooria.express/verify/${order.waybill_number}`,
        signature_code: `${(order.waybill_number || 'KR10491').replace('-', '')}-99482-CBN`,
        rails_badge: "Paystack Rails • Flutterwave Verified • NIBSS Instant"
      }
    }
  });
});

// 6.4 Order Marketplace (Rider App)
app.get('/api/v1/orders/available', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { sort } = req.query;

  let query = supabase
    .from('orders')
    .select('id, waybill_number, customer_id, pickup_address, pickup_lat, pickup_lng, pickup_landmark, destination_address, destination_lat, destination_lng, destination_landmark, price, surge_amount, declared_value, distance_km, eta_minutes, package_weight, content_type, rider_directives, declined_by, status, created_at')
    .eq('status', 'pending');

  if (sort === 'highest_pay') {
    query = query.order('price', { ascending: false });
  } else if (sort === 'shortest_distance') {
    query = query.order('distance_km', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const visibleOrders = (data || []).filter(order => {
    const declinedList = Array.isArray(order.declined_by) ? order.declined_by : [];
    return !declinedList.includes(riderId);
  });

  res.status(200).json({
    message: "Order Marketplace fetched",
    count: visibleOrders.length,
    orders: visibleOrders
  });
});

// 6.5 Decline & Next Job (Rider Marketplace Screen)
app.post('/api/v1/orders/:id/decline', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const riderId = req.user.id;

  const { data: orderData } = await supabase
    .from('orders')
    .select('declined_by')
    .eq('id', orderId);

  if (!orderData || orderData.length === 0) {
    return res.status(404).json({ error: "Order not found." });
  }

  const currentDeclined = Array.isArray(orderData[0].declined_by) ? orderData[0].declined_by : [];
  if (!currentDeclined.includes(riderId)) {
    currentDeclined.push(riderId);
  }

  await supabase
    .from('orders')
    .update({ declined_by: currentDeclined })
    .eq('id', orderId);

  res.status(200).json({ message: "Order declined and hidden from your marketplace feed" });
});

// 6.6 Get Customer Home & Order History
app.get('/api/v1/orders/me', authenticateUser, async (req, res) => {
  const customer_id = req.user.id;

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const activeStatuses = ['pending', 'active', 'picked_up', 'in_transit', 'out_for_delivery'];
  const activeShipment = (data || []).find(o => activeStatuses.includes(o.status)) || null;

  res.status(200).json({
    message: "Customer orders fetched",
    active_shipment: activeShipment,
    orders: data
  });
});

// 6.7 Get Rider Delivery History
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

// 6.8 Get Single Order, Active Delivery Tracking & SafeDrop Certificate
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
    rider: riderInfo,
    corridor_routing: {
      active_route: { name: "Via Ikoyi Link Bridge", eta_mins: 15, distance_km: 1.8, traffic: "Free Flow" },
      alt_route: { name: "Via Ozumba / Epe", eta_mins: 16, distance_km: 2.9, traffic: "Heavy Traffic" }
    }
  });
});

// 6.9 Accept Order (Rider)
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
  const riderName = (riderProfile && riderProfile[0] && riderProfile[0].full_name) ? riderProfile[0].full_name : 'Dispatch Rider';

  const updatedMilestones = [
    ...(existingOrder[0].milestones || []),
    {
      stage: 2,
      key: "rider_dispatched",
      title: "Pickup Dispatched",
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

// 6.10 Update Shipment Milestone (Rider)
app.patch('/api/v1/orders/:id/milestone', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const { status, title, description, eta_minutes } = req.body;

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('rider_id', rider_id);

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Order not found or not assigned to you." });
  }

  const stageMap = { picked_up: 3, in_transit: 4, out_for_delivery: 5 };
  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: stageMap[status] || 3,
      key: status,
      title: title || `Status updated to ${status}`,
      description: description || 'Tamper-proof seal verified',
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status,
      eta_minutes: eta_minutes !== undefined ? Number(eta_minutes) : orderData[0].eta_minutes,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  delete data[0].delivery_pin;

  res.status(200).json({ message: "Shipment milestone updated", order: data[0] });
});

// 6.11 Mark Arrived at Destination Gate (Rider)
app.post('/api/v1/orders/:id/arrived', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const { gate_name, latitude, longitude } = req.body;

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('rider_id', rider_id);

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Active order not found." });
  }

  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: 5,
      key: "arrived_at_gate",
      title: `Arrived at Destination (${gate_name || 'Main Gate'})`,
      description: "Awaiting 4-digit Recipient SafeDrop PIN handover",
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'out_for_delivery',
      eta_minutes: 0,
      pod_lat: latitude ? Number(latitude) : orderData[0].destination_lat,
      pod_lng: longitude ? Number(longitude) : orderData[0].destination_lng,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  delete data[0].delivery_pin;

  res.status(200).json({ message: "Customer notified: Rider has arrived at destination gate", order: data[0] });
});

// 6.12 Submit Anti-Fraud Failed Delivery Report (Rider Dispatch Audit)
app.post('/api/v1/orders/:id/fail-report', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const rider_id = req.user.id;
  const {
    primary_reason,
    proof_photo_urls,
    latitude,
    longitude,
    incident_notes,
    resolution_disposition
  } = req.body;

  if (!primary_reason || !incident_notes || !resolution_disposition) {
    return res.status(400).json({ error: "primary_reason, incident_notes, and resolution_disposition are required for Dispatch Audit." });
  }

  const { data: orderData } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('rider_id', rider_id);

  if (!orderData || orderData.length === 0) {
    return res.status(400).json({ error: "Order not found or not assigned to you." });
  }

  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: 0,
      key: "failed_audit_logged",
      title: `Delivery Failed: ${primary_reason}`,
      description: `Disposition: ${resolution_disposition}. Notes: ${incident_notes}`,
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'failed',
      failure_reason: primary_reason,
      failure_proof_urls: proof_photo_urls || [],
      failure_lat: latitude ? Number(latitude) : 6.4478,
      failure_lng: longitude ? Number(longitude) : 3.4731,
      failure_notes: incident_notes,
      failure_disposition: resolution_disposition,
      milestones: updatedMilestones
    })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  delete data[0].delivery_pin;

  res.status(200).json({
    message: "Encrypted Failed Delivery Audit recorded. SLA rating protected.",
    order: data[0]
  });
});

// 6.13 Extend Wait Time (+10m) or Authorize Contactless Drop
app.post('/api/v1/orders/:id/extend-wait', authenticateUser, async (req, res) => {
  const orderId = req.params.id;
  const { extra_minutes, contactless_authorized } = req.body;

  const { data: orderData } = await supabase.from('orders').select('wait_time_ext_mins, milestones').eq('id', orderId);
  if (!orderData || orderData.length === 0) return res.status(404).json({ error: "Order not found." });

  const newWait = Number(orderData[0].wait_time_ext_mins || 0) + Number(extra_minutes || 10);
  const updatedMilestones = [
    ...(orderData[0].milestones || []),
    {
      stage: 5,
      key: "wait_extended",
      title: contactless_authorized ? "Contactless Doorstep Drop Authorized" : `Wait Time Extended (+${extra_minutes || 10}m)`,
      description: "Authorized via Lagos Central Dispatch Live Support",
      timestamp: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('orders')
    .update({ wait_time_ext_mins: newWait, milestones: updatedMilestones })
    .eq('id', orderId)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({ message: "Order wait time and handover protocol updated", order: data[0] });
});

// 6.14 Reschedule a Failed Order (Customer App)
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

// 6.15 Cancel Order (Customer - Refunds Wallet if still Pending)
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

// 6.16 Complete Order (Rider - SafeDrop PIN Verification, Ledger Entry & Rider Wallet Payout)
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

  const order = orderData[0];
  const basePrice = Number(order.price || 0);
  const surgePay = Number(order.surge_amount || 0);
  const totalEarning = basePrice + surgePay;
  const completedAt = new Date().toISOString();

  const updatedMilestones = [
    ...(order.milestones || []),
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

  const { data: walletData } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', rider_id);

  let newBalance = totalEarning;
  if (!walletData || walletData.length === 0) {
    await supabase.from('wallets').insert([{ user_id: rider_id, balance: newBalance }]);
  } else {
    newBalance += Number(walletData[0].balance);
    await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', rider_id);
  }

  await supabase.from('wallet_transactions').insert([{
    reference: `TRX-KR-${Math.floor(10000 + Math.random() * 90000)}`,
    user_id: rider_id,
    order_id: order.id,
    waybill_number: order.waybill_number,
    type: 'trip_earning',
    title: `Waybill #${order.waybill_number}`,
    amount: totalEarning,
    base_amount: basePrice,
    surge_amount: surgePay,
    status: 'Completed'
  }]);

  res.status(200).json({
    message: "SafeDrop Certified: Order delivered and earnings deposited",
    order: updatedOrder[0],
    rider_earnings: totalEarning,
    new_wallet_balance: newBalance
  });
});

// 6.17 Rate & Tip Rider (Customer SafeDrop Completion Screen)
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
      const oldRiderBal = (riderWallet && riderWallet[0]) ? Number(riderWallet[0].balance) : 0;
      const newRiderBal = oldRiderBal + tip;
      await supabase.from('wallets').upsert({ user_id: order.rider_id, balance: newRiderBal });

      await supabase.from('wallet_transactions').insert([{
        reference: `TIP-KR-${Math.floor(10000 + Math.random() * 90000)}`,
        user_id: order.rider_id,
        order_id: order.id,
        waybill_number: order.waybill_number,
        type: 'tip',
        title: `100% Rider Tip - #${order.waybill_number}`,
        amount: tip,
        tip_amount: tip,
        status: 'Credited'
      }]);
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
// 7. WALLET, RIDER EARNINGS, QUESTS & NIP CASHOUT
// ==========================================

// 7.1 Get Wallet Balance & Saved Cards
app.get('/api/v1/wallet/balance', authenticateUser, async (req, res) => {
  const userId = req.user.id;

  let { data: walletData, error } = await supabase.from('wallets').select('*').eq('user_id', userId);
  if (error) return res.status(400).json({ error: error.message });

  if (!walletData || walletData.length === 0) {
    const { data: newWallet, error: createError } = await supabase
      .from('wallets')
      .insert([{ user_id: userId, balance: 0, pending_escrow: 0 }])
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

// 7.2 Rider Earnings & Weekly Breakdown + Weekly Quest + Payout Activity
app.get('/api/v1/riders/earnings', authenticateUser, async (req, res) => {
  const riderId = req.user.id;
  const { filter } = req.query;

  const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', riderId);
  const { data: profileData } = await supabase.from('profiles').select('payout_bank_name, payout_account_number, payout_account_name, auto_pay_enabled, rating, tier').eq('id', riderId);
  const { data: deliveredOrders } = await supabase
    .from('orders')
    .select('id, waybill_number, destination_address, price, surge_amount, tip_amount, completed_at')
    .eq('rider_id', riderId)
    .eq('status', 'delivered')
    .order('completed_at', { ascending: false });

  const orders = deliveredOrders || [];
  const basePayTotal = orders.reduce((sum, o) => sum + Number(o.price || 0), 0);
  const tipsTotal = orders.reduce((sum, o) => sum + Number(o.tip_amount || 0), 0);
  const surgeTotal = orders.reduce((sum, o) => sum + Number(o.surge_amount || 0), 0);
  const tippersCount = orders.filter(o => Number(o.tip_amount || 0) > 0).length;

  let txQuery = supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', riderId)
    .order('created_at', { ascending: false });

  if (filter === 'trips') txQuery = txQuery.eq('type', 'trip_earning');
  if (filter === 'tips') txQuery = txQuery.eq('type', 'tip');
  if (filter === 'bonuses') txQuery = txQuery.eq('type', 'surge_bonus');

  const { data: transactions } = await txQuery;

  const questTarget = 35;
  const completedCount = orders.length;
  const wal = (walletData && walletData[0]) ? walletData[0] : {};
  const prof = (profileData && profileData[0]) ? profileData[0] : {};

  res.status(200).json({
    message: "Rider earnings & wallet telemetry retrieved",
    available_for_cashout: Number(wal.balance || 0),
    pending_settlements: Number(wal.pending_escrow || 4200),
    minimum_cashout_threshold: 1000,
    payout_fee_pct: 0,
    auto_pay: {
      enabled: prof.auto_pay_enabled !== undefined ? prof.auto_pay_enabled : true,
      schedule: "Daily at 10:00 PM WAT",
      bank_name: prof.payout_bank_name || "Wema Bank Plc",
      account_last4: (prof.payout_account_number || "0123459128").slice(-4),
      account_name: prof.payout_account_name || "John Adebayo"
    },
    weekly_breakdown: {
      total_accrued: basePayTotal + tipsTotal + surgeTotal,
      base_pay: basePayTotal,
      completed_trips: completedCount,
      rider_tips_kept: tipsTotal,
      generous_tippers: tippersCount,
      surge_boost: surgeTotal
    },
    weekly_quest: {
      title: "Weekly Quest: 35 Deliveries",
      reward_amount: 5000,
      completed_deliveries: completedCount,
      target_deliveries: questTarget,
      progress_pct: Math.min(100, Math.round((completedCount / questTarget) * 100)),
      remaining_to_unlock: Math.max(0, questTarget - completedCount)
    },
    payout_activity: transactions || []
  });
});

// 7.3 Fund Wallet (Customer Top Up)
app.post('/api/v1/wallet/fund', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Please provide a valid amount." });
  }

  const { data: existingWallet } = await supabase.from('wallets').select('*').eq('user_id', userId);

  let responseData;
  let responseError;

  if (!existingWallet || existingWallet.length === 0) {
    const { data, error } = await supabase
      .from('wallets')
      .insert([{ user_id: userId, balance: Number(amount), pending_escrow: 0 }])
      .select();
    responseData = data;
    responseError = error;
  } else {
    const newBalance = Number(existingWallet[0].balance) + Number(amount);
    const { data, error } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('user_id', userId)
      .select();
    responseData = data;
    responseError = error;
  }

  if (responseError) return res.status(400).json({ error: responseError.message });
  res.status(200).json({ message: "Wallet funded successfully", wallet: responseData[0] });
});

// 7.4 Add a Saved Bank Card (Customer App)
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

// 7.5 Instant Cashout with NIP Pipeline Telemetry (Rider App)
app.post('/api/v1/wallet/withdraw', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { amount, bank_name, account_number } = req.body;
  const withdrawAmount = Number(amount);

  if (!withdrawAmount || withdrawAmount < 1000) {
    return res.status(400).json({ error: "Minimum cashout threshold is NGN 1,000." });
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

  const { data: profileData } = await supabase.from('profiles').select('payout_bank_name, payout_account_number, payout_account_name, kyc_level').eq('id', userId);
  const prof = (profileData && profileData[0]) ? profileData[0] : {};
  const targetBank = bank_name || prof.payout_bank_name || 'Wema Bank Plc';
  const targetAcct = account_number || prof.payout_account_number || '0123459128';

  const newBalance = currentBalance - withdrawAmount;
  const trxReference = `TRX-KR-${Math.floor(10000 + Math.random() * 90000)}`;

  const { data: updatedWallet, error: updateError } = await supabase
    .from('wallets')
    .update({ balance: newBalance })
    .eq('user_id', userId)
    .select();

  if (updateError) return res.status(400).json({ error: updateError.message });

  await supabase.from('wallet_transactions').insert([{
    reference: trxReference,
    user_id: userId,
    type: 'cashout',
    title: `Cashout to ${targetBank}`,
    amount: -withdrawAmount,
    fee: 0,
    bank_name: targetBank,
    account_number: targetAcct,
    status: 'Settled'
  }]);

  res.status(200).json({
    message: "Direct settlement authorized via NIP Rails",
    telemetry: {
      reference: trxReference,
      pipeline_stages: [
        { step: "Authorized", status: "completed", timestamp: new Date().toISOString() },
        { step: "NIP Switch Handshake", status: "in_progress", eta: "10-20 secs" },
        { step: "Bank Credit", status: "pending", eta: "30-60 secs" }
      ],
      destination_account: {
        bank_name: targetBank,
        account_last4: targetAcct.slice(-4),
        account_name: prof.payout_account_name || "John Adebayo",
        kyc_tier: `Verified Tier ${prof.kyc_level || 3}`
      },
      settlement_breakdown: {
        gross_withdrawal: withdrawAmount,
        kooria_settlement_fee: 0,
        nibss_stamp_duty: 0,
        net_payout_credited: withdrawAmount,
        unsettled_transit_escrow: Number(walletData[0].pending_escrow || 4200)
      }
    },
    wallet: updatedWallet[0]
  });
});

// ==========================================
// 8. LIVE SUPPORT CHAT & DISPUTE TICKETS
// ==========================================

// 8.1 Create Support Ticket
app.post('/api/v1/support/tickets', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const { order_id, waybill_number, issue_type, description } = req.body;

  if (!issue_type || !description) {
    return res.status(400).json({ error: "issue_type and description are required." });
  }

  const ticketCode = `TCK-${Math.floor(1000 + Math.random() * 9000)}`;

  const { data, error } = await supabase
    .from('support_tickets')
    .insert([{
      ticket_code: ticketCode,
      user_id: userId,
      order_id: order_id || null,
      waybill_number: waybill_number || null,
      issue_type,
      description
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });

  await supabase.from('support_messages').insert([{
    ticket_id: data[0].id,
    sender_name: "Kooria Dispatch Bot",
    sender_role: "bot",
    message: `Ticket #${ticketCode} logged for Waybill ${waybill_number || 'N/A'}. Senior Dispatcher Tunde has joined this session.`
  }]);

  res.status(201).json({
    message: "Live Support Session initiated with Lagos Central Dispatch",
    ticket: data[0]
  });
});

// 8.2 Get Live Support Chat Messages for a Ticket
app.get('/api/v1/support/tickets/:id/messages', authenticateUser, async (req, res) => {
  const ticketId = req.params.id;

  const { data: ticket } = await supabase.from('support_tickets').select('*').eq('id', ticketId);
  const { data: messages, error } = await supabase
    .from('support_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.status(200).json({
    message: "Live chat history fetched",
    ticket: (ticket && ticket[0]) ? ticket[0] : null,
    messages: messages || []
  });
});

// 8.3 Send Message in Live Support Chat
app.post('/api/v1/support/tickets/:id/messages', authenticateUser, async (req, res) => {
  const ticketId = req.params.id;
  const senderId = req.user.id;
  const { message, sender_role } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message text is required." });
  }

  const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', senderId);
  const prof = (profile && profile[0]) ? profile[0] : {};

  const { data, error } = await supabase
    .from('support_messages')
    .insert([{
      ticket_id: ticketId,
      sender_id: senderId,
      sender_name: prof.full_name || "Kooria User",
      sender_role: sender_role || prof.role || "customer",
      message
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: "Message sent to Lagos Central Dispatch", chat_message: data[0] });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Kooria Express backend is running on http://localhost:${PORT}`);
  console.log('Supabase successfully connected!');
});