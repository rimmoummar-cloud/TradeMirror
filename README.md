# TradeMirror OS

🚀 **Production-grade Trade Management & PDF Mirroring System**

Frontend: https://trade-mirror-teal.vercel.app  
Backend: Express API (deployed on Render)  
Database: Supabase (PostgreSQL + Auth + Storage)

---

## 📌 Overview

TradeMirror OS is a specialized internal system designed to manage **triangular trade operations**, where contracts are imported as PDFs, parsed, edited, and regenerated in a standardized mirrored format.

The system enables users to:
- Upload supplier contract PDFs
- Extract structured trade data
- Edit contract information through a dynamic form
- Generate a mirrored sales contract PDF
- Manage trades linked to clients
- Track financial and operational trade data
- Maintain banking profiles used in contract generation

---

## 🏗️ Tech Stack

### Frontend
- React (Vite)
- TypeScript
- React Query
- Tailwind CSS
- Supabase Client SDK

### Backend
- Node.js
- Express.js
- Supabase (PostgreSQL database + Auth + Storage)
- PDF processing (pdf-parse, pdf-lib)

### Deployment
- Frontend: Vercel
- Backend: Render
- Database: Supabase Cloud

---

## 📂 Core System Modules

### 1. Authentication & User Roles
- Supabase Auth (JWT-based)
- Invite-only user system
- Role-based access control:
  - `super_admin`
  - `admin`
  - `internal`
  - `partner`

Users are managed via an admin-only interface.

---

### 2. Clients Management
- Full CRUD system for clients
- Each client can have multiple trades
- Stores:
  - Company details
  - Contact information
  - Address and tax info

---

### 3. Trades System (Core Module)
Each trade represents a full business transaction lifecycle.

Features:
- Upload supplier PDF contract
- Extract structured data automatically
- Edit trade details via dynamic form
- Generate mirrored sales contract PDF
- Store trade record in database

Each trade includes:
- Client relation
- Financial calculations
- Status tracking (draft, active, completed, etc.)
- Document history

---

### 4. PDF Mirroring Engine
Core system feature that:
- Parses supplier PDFs using `pdf-parse`
- Applies structured overlay using `pdf-lib`
- Replaces specific fields while preserving layout
- Generates final sales contract PDF

Key logic:
- White-box overlay technique
- Field mapping system
- Template-based coordinate positioning

---

### 5. Banking System
Bank Profiles are used during contract generation.

Each bank profile includes:
- Beneficiary Name
- Beneficiary Address
- Bank Name
- Bank SWIFT
- Intermediary Bank details
- Account number / IBAN
- ARA number
- Field 71A instructions

Behavior:
- Admin selects a Bank Profile from dropdown
- System injects banking data into generated PDF
- Stored centrally in `bank_profiles` table
- Trade stores only `bank_profile_id`

---

### 6. Trade Folder (Document Management)
Each trade has a document repository:
- Original supplier contract (PDF)
- Generated sales contract (PDF)
- Signed contract (uploaded manually)
- Bill of Lading (BOL)
- Additional documents

Stored using Supabase Storage.

---

### 7. Financial Tracking
Each trade includes:
- Purchase price (supplier side)
- Sale price
- Shipping costs
- Insurance costs
- Bank fees
- Net profit calculation

All values are auto-calculated where applicable.

---

### 8. Milestones & Status Flow
Trade lifecycle statuses:
- Draft
- Active
- Advance received
- Shipped
- Balance received
- Completed / Overdue

Payment milestones:
- 50% advance
- 50% balance after BOL

---

### 9. User Management
Super Admin features:
- Invite users
- Assign roles
- Activate / deactivate accounts
- Role-based permission control

---

## 🔐 Security Model
- Supabase Row Level Security (RLS)
- JWT authentication
- Backend role middleware validation
- Protected API routes per role

---



---

## 📦 Key Features Summary

✔ PDF contract upload & parsing  
✔ Mirrored contract generation  
✔ Dynamic trade editing form  
✔ Client management system  
✔ Banking profile system  
✔ Financial calculations per trade  
✔ Document storage per trade  
✔ Role-based access control  
✔ Invite-only authentication system  

---

## 🚀 Deployment

- Frontend deployed on Vercel
- Backend deployed on Render
- Supabase used for DB + Auth + Storage

Live App:
👉 https://trade-mirror-teal.vercel.app

---

## ⚙️ Environment Notes

Required environment variables:
- Supabase URL
- Supabase anon/service keys
- Render API base URL
- PDF generation config

---

## 🧠 Design Philosophy

This system is built for:
- High-precision contract mirroring
- Operational transparency
- Financial traceability per trade
- Minimization of manual contract rewriting
- Structured trade lifecycle tracking

---

## 📌 Status

This is an actively developed production system with core modules implemented and extended incrementally.

Some advanced modules (e.g. tax export, partner dashboard isolation, automated alerts) are defined in architecture but may be partially implemented depending on deployment phase.

---

## 👤 Author

Built as an internal operational system for structured trade management and PDF contract automation.



## 📊 Architecture Summary
