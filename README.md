# Kooria Express - Master Backend API (v3.4.1)

This repository contains the complete Node.js/Express backend and Supabase integration for both the **Kooria Express Customer App** and **Kooria Rider Fleet App**.

## Base URL
- **Production URL (Live):** `https://kooria-express-api.onrender.com`
- **Local Development:** `http://localhost:3000`

## Important Note for Postman & Frontend Testing
1. **Request Body Format:** For all `POST` and `PATCH` requests that send data, set the Postman Body tab to **`raw` -> `JSON`** (`Content-Type: application/json`). Do not leave the Body tab on `none`.
2. **Authentication Header:** All protected `/api/v1/*` endpoints require the logged-in user's Supabase JWT `access_token` in the request header:
```http
Authorization: Bearer <Supabase_Access_Token>
```

---

## 1. Network Status, Public Tracking & QR Escrow Verification

### 1.1 Splash Screen Network Status
- **Endpoint:** `GET /`
- **Auth Required:** No
- **Description:** Returns online rider count (`420`), active corridors, SLA metrics, and hub sync progress (`78%`) for Customer & Rider splash screens.

### 1.2 Public Quick Track by Waybill
- **Endpoint:** `GET /api/v1/orders/track/:waybill`
- **Auth Required:** No
- **Description:** Allows users on the Login screen to track a package using a waybill reference (e.g., `KR-10482`) without logging in.

### 1.3 Public QR Escrow Certificate Verification
- **Endpoint:** `GET /api/v1/verify/:waybill`
- **Auth Required:** No
- **Description:** Verifies tamper-proof CBN-NIP Escrow Certificates (`KR10491-99482-CBN`) when scanning the receipt QR code.

---

## 2. Customer Auth, Phone OTP, Rider Portal Login & 4-Step KYC Onboarding

### 2.1 Customer & Rider Sign Up ("Create a Kooria Account")
- **Endpoint:** `POST /api/v1/auth/register`
- **Auth Required:** No
- **Description:** Registers a new user in Supabase Auth, auto-creates their `profiles` record and Kooria Wallet (`0` balance), and returns their `access_token`.
- **Request Body (JSON):**
```json
{
  "full_name": "Amina Yusuf",
  "phone_number": "+2348031234567",
  "email": "amina@example.com",
  "password": "password123",
  "role": "customer"
}
```

### 2.2 Customer Login with Phone or Email ("Welcome back")
- **Endpoint:** `POST /api/v1/auth/login`
- **Auth Required:** No
- **Description:** Authenticates a customer using either their **Phone Number** (`+2348123456789`) OR **Email Address** (`name@domain.com`) plus their password, returning a fresh `access_token`.
- **Request Body (JSON):**
```json
{
  "identifier": "+2348031234567",
  "password": "password123",
  "remember_device": true
}
```

### 2.3 Forgot Password Reset ("Forgot Password?")
- **Endpoint:** `POST /api/v1/auth/forgot-password`
- **Auth Required:** No
- **Request Body (JSON):**
```json
{
  "email": "amina@example.com"
}
```

### 2.4 Send 6-Digit Phone Verification Code
- **Endpoint:** `POST /api/v1/auth/send-otp`
- **Auth Required:** No
- **Request Body (JSON):**
```json
{
  "phone_number": "+2348123456789",
  "channel": "sms"
}
```
- **Notes:** `channel` accepts `"sms"`, `"whatsapp"`, or `"call"`. Also returns `active_waybill_banner` if the phone number has an active delivery awaiting handshake.

### 2.5 Verify 6-Digit Phone Code
- **Endpoint:** `POST /api/v1/auth/verify-otp`
- **Auth Required:** No
- **Request Body (JSON):**
```json
{
  "phone_number": "+2348123456789",
  "otp_code": "582104"
}
```

### 2.6 Rider Portal Fast Login (Mobile / Driver ID + Security Rider PIN)
- **Endpoint:** `POST /api/v1/auth/rider-login`
- **Auth Required:** No
- **Request Body (JSON):**
```json
{
  "identifier": "KR-402",
  "security_pin": "1234"
}
```
- **Notes:** `identifier` accepts either the rider's Driver ID (`KR-402`) or Registered Mobile (`+2348012345678`).

### 2.7 Submit 4-Step Rider Onboarding & KYC Verification ("Apply to Ride")
- **Endpoint:** `POST /api/v1/riders/onboarding/kyc`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "onboarding_step": 2,
  "save_for_later": false,
  "full_name": "John Adebayo",
  "phone_number": "+2348012345678",
  "nin_number": "VNIN-8821",
  "nin_slip_url": "https://.../nin-slip.pdf",
  "passport_photo_url": "https://.../selfie.jpg",
  "drivers_license": "LASDRI-2025-8821",
  "license_doc_url": "https://.../lasdri-front-back.jpg",
  "riders_permit": "LASSRA-MOT-9921",
  "mot_registration_url": "https://.../mot-ownership.pdf",
  "vehicle_model": "Boxer Bajaj 150cc",
  "plate_number": "LAG-492-FK",
  "payout_bank_name": "Wema Bank Plc",
  "payout_account_number": "0123459128",
  "payout_account_name": "John Adebayo"
}
```

### 2.8 Get Rider Onboarding Progress & Compliance Status
- **Endpoint:** `GET /api/v1/riders/onboarding/status`
- **Auth Required:** Yes

---

## 3. User Profile, KYC, Compliance & Security Settings

### 3.1 Get My Profile & Dashboard Stats
- **Endpoint:** `GET /api/v1/users/me`
- **Auth Required:** Yes
- **Description:** Returns Customer stats (`total_orders`, `safedrop_score`, `co2_saved_kg`, `tier`) AND Rider Fleet profile (`rider_code`, `kyc_level`, `completion_rate`, `on_time_rate`, `safety_strikes`, `nin_number`, `drivers_license`, `git_insurance_policy`, bike telemetry, and `gear_inspection`).

### 3.2 Update Profile, Preferences, Next of Kin & Payout Bank
- **Endpoint:** `PATCH /api/v1/users/me`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "full_name": "Amina Yusuf",
  "phone_number": "+2348123456789",
  "language": "English",
  "push_notifications": true,
  "whatsapp_updates": true,
  "sms_alerts": true,
  "two_factor_enabled": true,
  "next_of_kin_name": "Folake Adebayo (Wife)",
  "next_of_kin_phone": "08030001928"
}
```

### 3.3 Set / Reset 4-Digit SafeDrop PIN or Rider SafePass PIN
- **Endpoint:** `POST /api/v1/users/me/safedrop-pin`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "pin": "4821",
  "type": "safedrop"
}
```
- **Notes:** `type` can be `"safedrop"` (Customer handover PIN) or `"safepass"` (Rider login PIN).

---

## 4. Rider Fleet Dashboard, Telemetry, Gear, SOS & Performance Review (Rider App)

### 4.1 Get Rider Home Dashboard
- **Endpoint:** `GET /api/v1/riders/dashboard`
- **Auth Required:** Yes
- **Description:** Returns Rider online status, radar count (`4 Orders Near You`), `todays_summary`, `todays_earnings`, and `high_demand_surge_zones` (`Ikeja GRA +500`, `Yaba Tech +300`).

### 4.2 Toggle Rider Online / Standby Availability
- **Endpoint:** `PATCH /api/v1/riders/availability`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "is_online": true
}
```

### 4.3 Update Rider Live GPS & Speed
- **Endpoint:** `PATCH /api/v1/riders/location`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "latitude": 6.4474,
  "longitude": 3.4723,
  "speed_kmh": 42
}
```

### 4.4 Submit Daily Safety & Gear Inspection Checklist
- **Endpoint:** `PATCH /api/v1/riders/gear-inspection`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "bluetooth_helmet": true,
  "insulated_box": true,
  "high_vis_jacket": true,
  "rain_suit_mount": true
}
```

### 4.5 Log Bike Maintenance / Flag Telemetry Issue
- **Endpoint:** `POST /api/v1/riders/maintenance`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "issue_type": "maintenance_flag",
  "title": "Brake pad inspection",
  "description": "Front brake caliper check requested",
  "tire_pressure_psi": 32,
  "battery_telemetry": 92
}
```

### 4.6 Trigger SOS Emergency / LASAMBUS / Traffic Blockage
- **Endpoint:** `POST /api/v1/riders/sos`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "order_id": "uuid",
  "incident_type": "traffic_blockage",
  "description": "Severe gridlock flagged on Ozumba Mbadiwe Way",
  "latitude": 6.4311,
  "longitude": 3.4245
}
```

### 4.7 Get Critical Priority Dispatch Offer (`#KX-912` - 28s Countdown Screen)
- **Endpoint:** `GET /api/v1/riders/critical-offer`
- **Auth Required:** Yes
- **Description:** Returns the high-priority 28-second dispatch offer (`3rd Mainland Bridge Express`), guaranteed net pay (`5,200`), `TOLL PAID` & `PRIORITY` badges, pickup/dropoff coordinates, cargo spec (`iPhone 16 Pro • N150k Insured`), and corridor weather/traffic status.

### 4.8 Get Weekly Performance Review & Gold Tier III Metrics
- **Endpoint:** `GET /api/v1/riders/performance-review`
- **Auth Required:** Yes
- **Description:** Returns Weekly Dispatch SLA KPIs (`99.2% Completion`, `98.4% On-Time SLA`, `4.96 Rating`, `100% SafeDrop`), Total Week Payout (`184,250`), Platinum Legend progress (`88%`), and Active Gold Tier Privileges.

### 4.9 Claim N15,000 Gold Tier Performance Bonus to Wallet
- **Endpoint:** `POST /api/v1/riders/claim-tier-bonus`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "bonus_amount": 15000
}
```

---

## 5. Address Book (Customer Dispatch Hub)

### 5.1 Get Saved Addresses
- **Endpoint:** `GET /api/v1/addresses?category=Personal&search=Lekki`
- **Auth Required:** Yes

### 5.2 Add New Saved Address
- **Endpoint:** `POST /api/v1/addresses`
- **Auth Required:** Yes
- **Request Body (JSON):**
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

### 5.3 Update Saved Address
- **Endpoint:** `PATCH /api/v1/addresses/:id`
- **Auth Required:** Yes

### 5.4 Delete Saved Address
- **Endpoint:** `DELETE /api/v1/addresses/:id`
- **Auth Required:** Yes

---

## 6. Order Lifecycle, Rider Delivery Journey (Scan & Custody), Escrow Tax Receipt & Anti-Fraud Audit

### 6.1 Estimate Fare & 7-Itemized Escrow Breakdown
- **Endpoint:** `POST /api/v1/orders/estimate`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "pickup_lat": 6.5158,
  "pickup_lng": 3.3718,
  "destination_lat": 6.4281,
  "destination_lng": 3.4219
}
```

### 6.2 Create Order (Step 1 & 2 Complete Flow)
- **Endpoint:** `POST /api/v1/orders`
- **Auth Required:** Yes
- **Request Body (JSON):**
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
  "declared_value": 45000,
  "surge_amount": 400,
  "distance_km": 14.2,
  "price": 4850,
  "payment_method": "Kooria Wallet"
}
```

### 6.3 Get Official CBN-NIP Audited Escrow Certificate & Tax Receipt
- **Endpoint:** `GET /api/v1/orders/:id/receipt`
- **Auth Required:** Yes
- **Description:** Generates the 7-itemized financial breakdown (`Base Delivery`, `Priority Express Surcharge`, `Lekki-Ikoyi Link Bridge Toll`, `Goods Insurance`, `SafeDrop Escrow Guarantee`, `VAT Levy`, `Gold Member 5% Promo`), transaction reference (`TRX-NG-2024-99482`), and QR verification payload.

### 6.4 Order Marketplace (Rider App)
- **Endpoint:** `GET /api/v1/orders/available?sort=highest_pay`
- **Auth Required:** Yes
- **Notes:** Supports `?sort=highest_pay` or `?sort=shortest_distance`. Automatically excludes orders declined by the logged-in rider.

### 6.5 Decline & Next Job (Rider App)
- **Endpoint:** `POST /api/v1/orders/:id/decline`
- **Auth Required:** Yes

### 6.6 Get Customer Home & Order History
- **Endpoint:** `GET /api/v1/orders/me`
- **Auth Required:** Yes

### 6.7 Get Rider Delivery History
- **Endpoint:** `GET /api/v1/orders/rider-history`
- **Auth Required:** Yes

### 6.8 Get Single Order, Active Corridor Routing & SafeDrop Certificate
- **Endpoint:** `GET /api/v1/orders/:id`
- **Auth Required:** Yes

### 6.9 Accept Order (Rider App)
- **Endpoint:** `PATCH /api/v1/orders/:id/accept`
- **Auth Required:** Yes

### 6.10 Update Shipment Milestone (Rider App)
- **Endpoint:** `PATCH /api/v1/orders/:id/milestone`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "status": "out_for_delivery",
  "title": "Out for Delivery",
  "description": "Rider is ~3.2 km away heading toward Lekki Toll Gate",
  "eta_minutes": 24
}
```

### 6.11 Mark Arrived at Destination Gate (Rider App)
- **Endpoint:** `POST /api/v1/orders/:id/arrived`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "gate_name": "Gate 2",
  "latitude": 6.4474,
  "longitude": 3.4723
}
```

### 6.12 Submit Anti-Fraud Failed Delivery Report (Rider Dispatch Audit)
- **Endpoint:** `POST /api/v1/orders/:id/fail-report`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "primary_reason": "Customer unreachable",
  "proof_photo_urls": ["https://.../gate-proof-1.jpg"],
  "latitude": 6.4478,
  "longitude": 3.4731,
  "incident_notes": "Waited 15 mins at Admiralty Gate 3. Security called Flat 2B three times with no response.",
  "resolution_disposition": "return_to_hub"
}
```

### 6.13 Extend Wait Time (+10m) or Authorize Contactless Drop
- **Endpoint:** `POST /api/v1/orders/:id/extend-wait`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "extra_minutes": 10,
  "contactless_authorized": true
}
```

### 6.14 Reschedule Failed Order (Customer App)
- **Endpoint:** `PATCH /api/v1/orders/:id/reschedule`
- **Auth Required:** Yes

### 6.15 Cancel Pending Order (Customer App)
- **Endpoint:** `PATCH /api/v1/orders/:id/cancel`
- **Auth Required:** Yes

### 6.16 Complete Order with SafeDrop PIN & Digital Signature Canvas (Rider App)
- **Endpoint:** `PATCH /api/v1/orders/:id/complete`
- **Auth Required:** Yes
- **Description:** Verifies 4-digit PIN, records AI parcel threshold photo, `recipient_relationship` (`Recipient Self`, `Estate Security`, `Authorized Proxy`), 240Hz Digital Signature Canvas (`POD-ADELEKE-KR`), and credits the rider's wallet.
- **Request Body (JSON):**
```json
{
  "pin": "4821",
  "pod_photo_url": "https://.../doorstep-proof.jpg",
  "pod_lat": 6.4474,
  "pod_lng": 3.4723,
  "recipient_relationship": "Recipient Self",
  "signature_canvas_id": "POD-ADELEKE-KR",
  "signature_data_url": "data:image/png;base64,...",
  "signee_name": "Babatunde Adeleke",
  "estate_gate_note": "Handed over directly at Villa 7 gate."
}
```

### 6.17 Rate & Tip Rider (Customer App)
- **Endpoint:** `POST /api/v1/orders/:id/rate-and-tip`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "rating": 5,
  "feedback": "Fast and polite delivery!",
  "tip_amount": 500
}
```

### 6.18 Scan Parcel QR Barcode or Manual Alphanumeric Waybill Entry (Rider Pickup Step 1)
- **Endpoint:** `POST /api/v1/orders/scan-verify`
- **Auth Required:** Yes
- **Description:** Validates a scanned QR barcode (`#KR-10491`) or manual fallback code (`KR-10491-LAG`) when a label is smudged by rain, returning Sender Handover details, Leadway Insurance cap, and Trip Ref `#KX-842`.
- **Request Body (JSON):**
```json
{
  "waybill_code": "KR-10491",
  "recipient_phone": "08012345678",
  "hub_bay": "OTIGBA HUB • BAY 04"
}
```

### 6.19 Pickup Verification & Custody Sign-Off (Rider Step 2 of 3)
- **Endpoint:** `POST /api/v1/orders/:id/pickup-custody`
- **Auth Required:** Yes
- **Description:** Verifies the 3 Mandatory Physical Inspection checks (`seal_intact`, `box_dry_undamaged`, `qr_readable`), geo-tagged Proof of Pickup photo (`IMG_KR_IKEJA_10491.jpg`), and transfers custody from Sender to Rider (`SEC-0931-LAG`).
- **Request Body (JSON):**
```json
{
  "seal_intact": true,
  "box_dry_undamaged": true,
  "qr_readable": true,
  "pickup_photo_url": "https://.../IMG_KR_IKEJA_10491.jpg",
  "latitude": 6.5952,
  "longitude": 3.3385,
  "pouch_id": "Tamper-proof Pouch #82"
}
```

### 6.20 Offline Mode ECDSA SHA-256 Custody Sync (Zero-Bars Offline Vault)
- **Endpoint:** `POST /api/v1/orders/offline-custody`
- **Auth Required:** Yes
- **Description:** Syncs on-device ECDSA SHA-256 Proof-of-Custody hashes (`0x7F2A...9814`) queued when the rider is in an offline corridor.
- **Request Body (JSON):**
```json
{
  "waybill_number": "KR-10491",
  "ecdsa_public_key_hash": "0x7F2A...9814",
  "latitude": 6.5952,
  "longitude": 3.3385
}
```

### 6.21 Pre-Verify Recipient SafeDrop PIN at Doorstep (Step 3 of 3 Dual-Auth)
- **Endpoint:** `POST /api/v1/orders/:id/verify-pin`
- **Auth Required:** Yes
- **Description:** Checks 12m GPS proximity lock and validates the 4-digit SafeDrop passcode (`5821`) before final signature/photo capture.
- **Request Body (JSON):**
```json
{
  "pin": "5821",
  "rider_lat": 6.4312,
  "rider_lng": 3.4758
}
```

### 6.22 Resend SafeDrop SMS/WhatsApp OTP to Customer from Rider Console
- **Endpoint:** `POST /api/v1/orders/:id/resend-pin`
- **Auth Required:** Yes

### 6.23 Submit Critical Package Damage Escalation (`ESC-9041` - Rider SafeHarbor Guarantee)
- **Endpoint:** `POST /api/v1/orders/:id/damage-escalation`
- **Auth Required:** Yes
- **Description:** Pauses escrow and logs high-value cargo damage (`torn_seal`, `liquid_spillage`, `crushed_impact`, `merchant_defect`, `recipient_refusal`) with photo evidence, voice memo, and disposition (`return_to_hub`, `secure_locker`, `await_instructions`) with zero rider SLA penalty.
- **Request Body (JSON):**
```json
{
  "primary_severity": "torn_seal",
  "photo_evidence_urls": ["https://.../seal-photo.jpg", "https://.../box-corner.jpg"],
  "incident_narrative": "Outer protective bubble wrap was compromised upon handover at Otigba Bay 4.",
  "voice_memo_url": "https://.../memo-24s.mp3",
  "immediate_action": "return_to_hub",
  "latitude": 6.5124,
  "longitude": 3.3912
}
```

### 6.24 Get Post-Delivery Trip Summary & Earnings Breakdown (`#KX-842`)
- **Endpoint:** `GET /api/v1/orders/:id/trip-summary`
- **Auth Required:** Yes
- **Description:** Returns the completed trip summary (`Beat SLA by 7 Mins! +500 Bonus`), itemized rider earnings (`Base Delivery Fee`, `High-Value Escrow`, `Ikoyi Link Bridge E-Toll Reimbursement`, `5-Star SLA Speed Tip`, `8% Platform Fee Waived`), customer 5-star review, vehicle fuel/pace stats, and POD archive links.

---

## 7. Wallet, Rider Earnings, Quests & Instant NIP Cashout

### 7.1 Get Wallet Balance & Saved Cards
- **Endpoint:** `GET /api/v1/wallet/balance`
- **Auth Required:** Yes

### 7.2 Get Rider Earnings, Weekly Breakdown, 35-Trip Quest & Payout Activity
- **Endpoint:** `GET /api/v1/riders/earnings?filter=all`
- **Auth Required:** Yes
- **Notes:** Optional query param `filter` accepts `all`, `trips`, `tips`, or `bonuses`.

### 7.3 Fund Wallet (Customer Top Up)
- **Endpoint:** `POST /api/v1/wallet/fund`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "amount": 5000
}
```

### 7.4 Save Bank Card (Customer App)
- **Endpoint:** `POST /api/v1/wallet/cards`
- **Auth Required:** Yes
- **Request Body (JSON):**
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

### 7.5 Rider Instant Cashout (NIP Settlement Telemetry)
- **Endpoint:** `POST /api/v1/wallet/withdraw`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "amount": 28650,
  "bank_name": "Wema Bank Plc",
  "account_number": "0123459128"
}
```

---

## 8. Live Support Chat & Dispute Center (`#TCK-8821`)

### 8.1 Open Support / Dispute Ticket
- **Endpoint:** `POST /api/v1/support/tickets`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "order_id": "uuid",
  "waybill_number": "KR-10491",
  "issue_type": "gate_blocked",
  "description": "Recipient Estate Gate 2 intercom unresponsive."
}
```

### 8.2 Get Live Support Chat Messages
- **Endpoint:** `GET /api/v1/support/tickets/:id/messages`
- **Auth Required:** Yes

### 8.3 Send Message in Live Support Chat
- **Endpoint:** `POST /api/v1/support/tickets/:id/messages`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "message": "The intercom is down today, please tell John to use gate code #4491.",
  "sender_role": "customer"
}
```

---

## 9. Push & In-App Notifications (Bell Icon)

### 9.1 Register Device Push Token (FCM / Expo)
- **Endpoint:** `POST /api/v1/notifications/device-token`
- **Auth Required:** Yes
- **Request Body (JSON):**
```json
{
  "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

### 9.2 Get In-App Notifications & Unread Badge Count
- **Endpoint:** `GET /api/v1/notifications`
- **Auth Required:** Yes

### 9.3 Mark Single Notification as Read
- **Endpoint:** `PATCH /api/v1/notifications/:id/read`
- **Auth Required:** Yes

### 9.4 Mark All Notifications as Read
- **Endpoint:** `PATCH /api/v1/notifications/read-all`
- **Auth Required:** Yes