# Kooria Express - Backend API (v3.4.1)

This repository contains the complete Node.js/Express backend and Supabase integration for the **Kooria Express Customer and Rider Apps**.

## Base URL
* **Local Development:** `http://localhost:3000`
* **Production URL:** *(Insert Render URL here)*

---

## Authentication
All `/api/v1/*` endpoints (except Public Quick Track) require the user's Supabase JWT token.
**Header:** `Authorization: Bearer <Supabase_Access_Token>`

---

## 1. Network Status & Public Waybill Tracking

### 1.1 Splash Screen Network Status
**Endpoint:** `GET /`
*Returns online rider count and SLA metrics for the splash screen.*

### 1.2 Public Quick Track by Waybill (No Login Required)
**Endpoint:** `GET /api/v1/orders/track/:waybill`
*Allows users on the Login screen to track a package using a waybill reference (e.g. `KR-10482`) without logging in.*

---

## 2. User Account, Stats & Security Preferences

### 2.1 Get Profile & Account Dashboard Stats
**Endpoint:** `GET /api/v1/users/me`
*Fetches user details, Gold membership status, Total Orders, SafeDrop Score (`4.9`), `co2_saved_kg`, and default pickup address.*

**Success Response (200 OK):**
```json
{
  "message": "Profile and stats retrieved",
  "profile": {
    "id": "uuid",
    "full_name": "Amina Yusuf",
    "phone_number": "+2348123456789",
    "email": "amina.yusuf@gmail.com",
    "tier": "Gold",
    "language": "English",
    "push_notifications": true,
    "whatsapp_updates": true,
    "sms_alerts": true,
    "two_factor_enabled": true,
    "stats": {
      "total_orders": 58,
      "completed_shipments": 58,
      "safedrop_score": 4.9,
      "co2_saved_kg": 14.2
    }
  }
}
```

### 2.2 Update Profile & Notification Preferences
**Endpoint:** `PATCH /api/v1/users/me`

**Request Body (JSON):**
```json
{
  "full_name": "Amina Yusuf",
  "phone_number": "+2348123456789",
  "language": "English",
  "push_notifications": true,
  "whatsapp_updates": true,
  "sms_alerts": false,
  "two_factor_enabled": true
}
```

### 2.3 Set / Reset 4-Digit SafeDrop Handover PIN
**Endpoint:** `POST /api/v1/users/me/safedrop-pin`

**Request Body (JSON):**
```json
{
  "pin": "4821"
}
```

### 2.4 Update Rider Live GPS & Speed (Rider App)
**Endpoint:** `PATCH /api/v1/riders/location`

**Request Body (JSON):**
```json
{
  "latitude": 6.4474,
  "longitude": 3.4723,
  "speed_kmh": 32
}
```

---

## 3. Address Book (Dispatch Hub)

### 3.1 Get Saved Addresses
**Endpoint:** `GET /api/v1/addresses?category=Personal&search=Lekki`
*Optional query params: `category` (`Personal`, `Business`, `Hub`) and `search`.*

### 3.2 Add New Saved Address
**Endpoint:** `POST /api/v1/addresses`

**Request Body (JSON):**
```json
{
  "label": "Home",
  "category": "Personal",
  "area": "Lekki Phase 1, Lagos",
  "street_address": "Block B, Flat 4, Ocean Palms Estate, Admiralty Way",
  "latitude": 6.4474,
  "longitude": 3.4723,
  "landmark": "Opposite Filmhouse Cinemas, right after the black automated gate.",
  "rider_note": "Buzz Flat 4 on intercom. If unavailable, leave with security guard Sunday.",
  "contact_name": "Adeolu O.",
  "contact_phone": "+2348021234567",
  "is_default": true
}
```

### 3.3 Update Saved Address
**Endpoint:** `PATCH /api/v1/addresses/:id`

### 3.4 Delete Saved Address
**Endpoint:** `DELETE /api/v1/addresses/:id`

---

## 4. Send Package, Live Radar & SafeDrop Delivery

### 4.1 Estimate Fare & Route Time (Step 2 of 2)
**Endpoint:** `POST /api/v1/orders/estimate`

**Request Body (JSON):**
```json
{
  "pickup_lat": 6.5158,
  "pickup_lng": 3.3718,
  "destination_lat": 6.4281,
  "destination_lng": 3.4219
}
```

### 4.2 Create Order (Step 1 & 2 Complete Flow)
**Endpoint:** `POST /api/v1/orders`
*Deducts fare from wallet, generates Waybill (`#KR-10482`) and 4-digit PIN, and initializes Stage 1 milestone.*

**Request Body (JSON):**
```json
{
  "pickup_address": "14 Commercial Ave, Sabo Yaba, Lagos",
  "pickup_lat": 6.5158,
  "pickup_lng": 3.3718,
  "pickup_landmark": "Opposite Ozone Cinemas, behind FCMB",
  "sender_name": "Adeolu O.",
  "sender_phone": "+2348021234567",
  "destination_address": "Block B, Flat 4, Ocean Palms Estate, Lekki Phase 1",
  "destination_lat": 6.4281,
  "destination_lng": 3.4219,
  "destination_landmark": "Opposite Domino's Pizza, 2nd black gate",
  "gate_instructions": "Buzz flat 2B or notify security at estate gate",
  "recipient_name": "Babatunde Adeleke",
  "recipient_phone": "+2348034567890",
  "rider_directives": ["Call on arrival", "Fragile item handling", "OTP delivery only"],
  "package_weight": "1.8 kg (Medium)",
  "content_type": "Electronics & Docs",
  "distance_km": 14.2,
  "price": 2400
}
```

### 4.3 Get Customer Home Dashboard & Order History
**Endpoint:** `GET /api/v1/orders/me`
*Returns `active_shipment` (for the Home screen live card) and `orders` (Recent Deliveries list).*

### 4.4 Track Single Order, Milestones & SafeDrop Certificate
**Endpoint:** `GET /api/v1/orders/:id`
*Returns full order details, 6-stage `milestones` array, SafeDrop GPS lock/photo proof, and assigned rider's live coordinates, speed, and bike details.*

### 4.5 Fetch Available Pending Orders (Rider App)
**Endpoint:** `GET /api/v1/orders/available`

### 4.6 Accept Order (Rider App)
**Endpoint:** `PATCH /api/v1/orders/:id/accept`

### 4.7 Update Shipment Milestone (Rider App)
**Endpoint:** `PATCH /api/v1/orders/:id/milestone`
*Updates order progress across the 6 stages (`picked_up`, `in_transit`, `out_for_delivery`, or `failed`).*

**Request Body (JSON):**
```json
{
  "status": "out_for_delivery",
  "title": "Out for Delivery",
  "description": "Rider is ~3.2 km away heading toward Lekki Toll Gate",
  "eta_minutes": 24
}
```

### 4.8 Reschedule Failed Delivery (Customer App)
**Endpoint:** `PATCH /api/v1/orders/:id/reschedule`
*Re-queues a `failed` delivery back to `pending` for re-attempt.*

### 4.9 Cancel Pending Order (Customer App)
**Endpoint:** `PATCH /api/v1/orders/:id/cancel`
*Cancels a `pending` order and automatically refunds the customer's Kooria Wallet.*

### 4.10 Complete Order with SafeDrop Handshake (Rider App)
**Endpoint:** `PATCH /api/v1/orders/:id/complete`
*Verifies the 4-digit PIN, records GPS coordinate lock and handover photo, marks order `delivered`, and credits rider wallet.*

**Request Body (JSON):**
```json
{
  "pin": "4821",
  "pod_photo_url": "https://...",
  "pod_lat": 6.4474,
  "pod_lng": 3.4723
}
```

### 4.11 Rate & Tip Rider (SafeDrop Delivered Screen)
**Endpoint:** `POST /api/v1/orders/:id/rate-and-tip`
*Records 1–5 star rating and transfers optional tip (`+500` or `+1000`) from customer wallet to rider wallet.*

**Request Body (JSON):**
```json
{
  "rating": 5,
  "feedback": "Fast and polite delivery!",
  "tip_amount": 500
}
```

---

## 5. Wallet & Saved Cards

### 5.1 Get Wallet Balance & Saved Cards
**Endpoint:** `GET /api/v1/wallet/balance`

### 5.2 Fund Wallet (Instant Top Up)
**Endpoint:** `POST /api/v1/wallet/fund`

**Request Body (JSON):**
```json
{
  "amount": 5000
}
```

### 5.3 Save Bank Card
**Endpoint:** `POST /api/v1/wallet/cards`

**Request Body (JSON):**
```json
{
  "bank_name": "GTBank Lagos",
  "card_brand": "Mastercard Debit",
  "last4": "4291",
  "exp_month": "09",
  "exp_year": "27",
  "is_default": true
}
```

### 5.4 Withdraw Funds (Rider App)
**Endpoint:** `POST /api/v1/wallet/withdraw`

---

## 6. Support & Dispute Center

### 6.1 Report Delivery Issue / Claim Center
**Endpoint:** `POST /api/v1/support/tickets`

**Request Body (JSON):**
```json
{
  "order_id": "uuid",
  "waybill_number": "KR-10482",
  "issue_type": "delivery_issue",
  "description": "Package delayed at toll gate."
}
```