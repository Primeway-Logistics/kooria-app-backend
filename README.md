# Kooria Express - Backend API

This repository contains the Node.js/Express backend and Supabase integration for the Kooria Express mobile app.

## Base URL
Local development: `http://localhost:3000`
*(Production URL pending deployment)*

---

## 1. Create a New Order (Customer App)
**Endpoint:** `POST /api/v1/orders`

**Request Body (JSON):**
```json
{
  "pickup_address": "123 Ikeja Road, Lagos",
  "destination_address": "45 Yaba Tech, Lagos",
  "price": "4500"
}