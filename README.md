# Kooria Express - Backend API

This repository contains the Node.js/Express backend and Supabase integration for the Kooria Express mobile app.

## Base URL
Local development: `http://localhost:3000`
*(Production URL pending deployment)*

---

## Authentication (Required)
All endpoints are secured. The frontend must pass the Supabase user token in the headers of every request.
**Header:** `Authorization: Bearer <Supabase_Access_Token>`

---

## 1. Create a New Order (Customer App)
**Endpoint:** `POST /api/v1/orders`
*Creates a new order. Customer ID is extracted securely from the Auth Token.*

**Request Body (JSON):**
```json
"order": [ 
    { 
      "id": "uuid", 
      "status": "pending", 
      "delivery_pin": "4921" 
    } 
  ]

Success Response (201 Created):

son
{
"message": "Order created and payment deducted successfully",
"order": {
"id": "uuid",
"customer_id": "uuid-of-logged-in-customer",
"pickup_address": "123 Ikeja Road, Lagos",
"status": "pending",
"price": 4500
},
"remaining_balance": 500
}

2. Fetch Available Orders (Rider App)
Endpoint: GET /api/v1/orders/availableFetches all orders that currently have a pending status.

Request Body: None

Success Response (200 OK):

{
  "message": "Available orders fetched successfully",
  "orders": [ 
    { 
      "id": "uuid", 
      "status": "pending",
      "price": "4500"
    } 
  ]
}

3. Accept an Order (Rider App)
Endpoint: PATCH /api/v1/orders/:id/acceptChanges the order status from pending to active and assigns the rider.

URL Parameter: Replace :id with the unique ID of the order being accepted.

Request Body: None (Rider ID is extracted securely from the Auth Token)

Success Response (200 OK):

{
  "message": "Order accepted successfully",
  "order": { 
    "id": "uuid", 
    "status": "active", 
    "rider_id": "uuid-of-the-logged-in-rider" 
  }
}

4. Complete an Order (Rider App)
Endpoint: PATCH /api/v1/orders/:id/completeMarks an active order as delivered. Must be requested by the assigned rider.

URL Parameter: Replace :id with the unique order ID.

Request Body: None (Rider ID is extracted securely from the Auth Token)

Success Response (200 OK):

json
{
"message": "Order delivered and earnings deposited",
"order": {
"id": "uuid",
"status": "delivered",
"rider_id": "uuid-of-the-logged-in-rider",
"price": 4500
},
"rider_earnings": 4500,
"new_wallet_balance": 4500
}

---

## 5. Get Wallet Balance
**Endpoint:** `GET /api/v1/wallet/balance`
*Fetches the logged-in user's wallet balance. Auto-creates a wallet if none exists.*

**Request Body:** None

**Success Response (200 OK):**

json
{
"message": "Wallet retrieved",
"wallet": {
"id": 1,
"user_id": "uuid-of-logged-in-user",
"balance": 0
}
}

---

## 6. Fund Wallet
**Endpoint:** `POST /api/v1/wallet/fund`
*Simulates adding funds to a user's wallet.*

**Request Body (JSON):**

json
{
"amount": 5000
}

**Success Response (200 OK):**

json
{
"message": "Wallet funded successfully",
"wallet": {
"id": 1,
"user_id": "uuid-of-logged-in-user",
"balance": 5000
}
}

