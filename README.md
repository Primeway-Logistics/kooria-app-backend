# Kooria Express - Backend API

This repository contains the Node.js/Express backend and Supabase integration for the Kooria Express Customer and Rider mobile applications.

## Base URL
Local development: `http://localhost:3000`
*(Production URL pending deployment)*

---

## Authentication (Required)
All `/api/v1/*` endpoints are secured. The frontend must pass the logged-in user's Supabase JWT access token in the headers of every request.
**Header:** `Authorization: Bearer <Supabase_Access_Token>`

---

## User Profile & Live GPS Endpoints

### 1. Get My Profile
**Endpoint:** `GET /api/v1/users/me`
*Fetches the logged-in user's profile. Auto-creates a profile record if none exists.*

**Success Response (200 OK):**
```
---

## Authentication (Required)
All `/api/v1/*` endpoints are secured. The frontend must pass the logged-in user's Supabase JWT access token in the headers of every request.
**Header:** `Authorization: Bearer <Supabase_Access_Token>`

---

## User Profile & Live GPS Endpoints

### 1. Get My Profile
**Endpoint:** `GET /api/v1/users/me`
*Fetches the logged-in user's profile. Auto-creates a profile record if none exists.*

**Success Response (200 OK):**
```
json
{
"message": "Profile retrieved",
"profile": {
"id": "uuid",
"full_name": "Chidi Okonkwo",
"phone_number": "08012345678",
"role": "customer",
"avatar_url": "https://...",
"current_lat": null,
"current_lng": null
}
}


### 2. Update My Profile
**Endpoint:** `PATCH /api/v1/users/me`
*Updates user details or switches role (`customer` or `rider`).*

**Request Body (JSON):**
json
{
"full_name": "Chidi Okonkwo",
"phone_number": "08012345678",
"role": "customer",
"avatar_url": "https://..."
}


### 3. Update Rider Live GPS Location (Rider App)
**Endpoint:** `PATCH /api/v1/riders/location`
*Updates the logged-in rider's live coordinates on the map.*

**Request Body (JSON):**
json
{
"latitude": 6.5244,
"longitude": 3.3792
}


---

## Order Management Endpoints

### 4. Create a New Order (Customer App)
**Endpoint:** `POST /api/v1/orders`
*Deducts the order price from the customer's wallet, generates a 4-digit delivery PIN, and creates a pending order.*

**Request Body (JSON):**
json
{
"pickup_address": "123 Ikeja Road, Lagos",
"destination_address": "45 Yaba Tech, Lagos",
"price": 4500
}


**Success Response (201 Created):**
json
{
"message": "Order created and payment deducted successfully",
"order": {
"id": "uuid",
"customer_id": "uuid-of-customer",
"pickup_address": "123 Ikeja Road, Lagos",
"destination_address": "45 Yaba Tech, Lagos",
"price": 4500,
"status": "pending",
"delivery_pin": "4921"
},
"remaining_balance": 500
}


### 5. Fetch Available Orders (Rider App)
**Endpoint:** `GET /api/v1/orders/available`
*Fetches all `pending` orders waiting for a rider (excludes the secret delivery PIN).*

**Success Response (200 OK):**
json
{
"message": "Available orders fetched successfully",
"orders": [
{
"id": "uuid",
"customer_id": "uuid",
"pickup_address": "123 Ikeja Road, Lagos",
"destination_address": "45 Yaba Tech, Lagos",
"price": 4500,
"status": "pending",
"created_at": "2026-11-06T12:00:00Z"
}
]
}


### 6. Get Customer Order History (Customer App)
**Endpoint:** `GET /api/v1/orders/me`
*Fetches all past and active orders placed by the logged-in customer.*

### 7. Get Rider Delivery History (Rider App)
**Endpoint:** `GET /api/v1/orders/rider-history`
*Fetches all active and completed orders assigned to the logged-in rider.*

### 8. Track Single Order & Live Rider Location
**Endpoint:** `GET /api/v1/orders/:id`
*Fetches order details along with the assigned rider's profile and live GPS coordinates.*

**Success Response (200 OK):**
json
{
"message": "Order details fetched",
"order": {
"id": "uuid",
"status": "active",
"pickup_address": "123 Ikeja Road, Lagos",
"destination_address": "45 Yaba Tech, Lagos",
"price": 4500,
"delivery_pin": "4921"
},
"rider": {
"full_name": "Musa Ibrahim",
"phone_number": "08098765432",
"current_lat": 6.5244,
"current_lng": 3.3792
}
}


### 9. Accept an Order (Rider App)
**Endpoint:** `PATCH /api/v1/orders/:id/accept`
*Assigns the logged-in rider to the order and changes status from `pending` to `active`.*

**Request Body:** None *(Rider ID is extracted from the Auth Token)*

### 10. Cancel an Order (Customer App)
**Endpoint:** `PATCH /api/v1/orders/:id/cancel`
*Cancels a `pending` order and automatically refunds the price back to the customer's wallet.*

**Request Body:** None

### 11. Complete an Order (Rider App)
**Endpoint:** `PATCH /api/v1/orders/:id/complete`
*Verifies the customer's 4-digit PIN, marks the order as `delivered`, and deposits earnings into the rider's wallet.*

**Request Body (JSON):**
json
{
"pin": "4921"
}


**Success Response (200 OK):**
json
{
"message": "Order delivered and earnings deposited",
"order": {
"id": "uuid",
"status": "delivered",
"rider_id": "uuid-of-rider",
"price": 4500
},
"rider_earnings": 4500,
"new_wallet_balance": 4500
}


---

## Wallet & Payment Endpoints

### 12. Get Wallet Balance
**Endpoint:** `GET /api/v1/wallet/balance`
*Fetches the logged-in user's wallet balance (auto-creates wallet at `0` if none exists).*

### 13. Fund Wallet
**Endpoint:** `POST /api/v1/wallet/fund`
*Adds funds to the logged-in user's wallet.*

**Request Body (JSON):**
json
{
"amount": 5000
}


### 14. Withdraw Funds (Rider App)
**Endpoint:** `POST /api/v1/wallet/withdraw`
*Deducts funds from the rider's wallet for bank payout.*

**Request Body (JSON):**
json
{
"amount": 3000,
"bank_name": "GTBank",
"account_number": "0123456789"
}