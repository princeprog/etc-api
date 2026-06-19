# Car Dealership MVP Design

**Date:** 2026-06-19

**Project:** Buy & Sell Car Business Management System

## 1. Overview

This document defines the MVP design for an internal dealership operations system for a buy-and-sell car business. The system is intended to replace fragmented operational tracking across Facebook Messenger, phone notes, notebooks, whiteboards, and manual computations.

The MVP is intentionally focused on internal business control. It does not include a public website, Messenger integration, or an agent self-service portal. Its purpose is to centralize vehicle inventory, seller leads, buyer leads, follow-up activity, sales records, commissions, and management reporting in a single source of truth.

## 2. Product Direction

### 2.1 MVP positioning

The MVP is an internal back-office platform for the business owner and staff.

It should:
- capture seller and buyer inquiries through manual encoding
- drive daily work from an operations dashboard
- enforce moderate workflow controls for better data quality
- support default commission logic with manual override
- include authentication and role-based access from the start

It should not initially include:
- Messenger syncing or automation
- public vehicle listings
- SMS or email automation
- advanced Marketplace tooling
- agent self-service access

### 2.2 Primary operating loop

The core business loop for the system is:

`capture inquiry -> qualify -> follow up -> convert -> record sale -> report outcomes`

This loop should apply across both seller acquisition and buyer conversion workflows.

## 3. Users and Roles

### 3.1 Business Owner / Administrator

The owner or administrator has full access to:
- dashboard and reports
- vehicle inventory
- seller leads
- buyer leads
- follow-up activity
- sales records
- commission records
- user and role administration
- override actions on locked or financially sensitive records

### 3.2 Staff / Encoder

Staff members can:
- create and update seller leads
- create and update buyer leads
- create and update follow-ups
- create and update vehicle records
- create sales records
- apply commission data when permitted by workflow

Staff members should have limited access to:
- user administration
- sensitive override actions
- final edit of locked financial records after sale finalization

## 4. Functional Scope

### 4.1 Module 1: Vehicle Inventory Management

The system must maintain one centralized record per vehicle handled by the dealership.

Each vehicle record should support:
- core specifications
- pricing details
- remarks and notes
- photo uploads
- lifecycle status
- acquisition traceability
- sale linkage

Suggested fields:
- stock/reference number
- brand
- model
- year
- variant
- mileage
- transmission
- fuel type
- color
- region/location
- features
- remarks
- purchase price
- target selling price
- minimum acceptable price
- acquisition source
- linked seller lead, when applicable

Suggested statuses:
- `Incoming`
- `Reconditioning`
- `Available`
- `Reserved`
- `Sold`

### 4.2 Module 2: Seller Lead Management

Every seller inquiry should be recorded, even if the vehicle is not ultimately purchased.

Each seller lead should support:
- seller contact details
- offered vehicle details
- inquiry source
- lead status
- notes and activity history
- follow-up scheduling
- conversion to inventory when purchased

Suggested statuses:
- `New Inquiry`
- `Contacted`
- `Inspection Scheduled`
- `Negotiating`
- `Purchased`
- `Rejected`

### 4.3 Module 3: Buyer Lead Management

Every buyer inquiry should become a structured record tied to the sales process.

Each buyer lead should support:
- buyer contact details
- associated vehicles
- inquiry source
- communication history
- lead status
- follow-up scheduling
- outcome tracking

Suggested statuses:
- `New Inquiry`
- `Contacted`
- `Interested`
- `Negotiating`
- `Reserved`
- `Won`
- `Lost`

### 4.4 Module 4: Follow-Up Management

Follow-up management is a shared workflow layer for seller and buyer leads.

The module should support:
- creating follow-up tasks from seller leads or buyer leads
- assigning due dates and assignees
- capturing follow-up notes and outcomes
- distinguishing due, overdue, and completed follow-ups
- surfacing next actions in the dashboard

This module should remain operationally simple. It is not intended to become a general task management platform.

### 4.5 Module 5: Sales and Commission Tracking

Each completed sale should create a formal sales record linked to the sold unit and relevant buyer context.

Sales records should include:
- linked vehicle
- linked buyer lead
- sale date
- final sale amount
- gross profit basis, where available
- responsible staff encoder
- optional agent attribution
- commission method
- commission default value
- commission override value and reason, when used

### 4.6 Module 6: Dashboard and Reporting

The default home screen should be an operations dashboard designed around immediate work and visibility.

Priority dashboard panels:
- overdue follow-ups
- follow-ups due today
- new seller inquiries
- new buyer inquiries
- available vehicle count
- reserved vehicle count
- sold vehicle count
- current month sales
- current month revenue
- current month profit
- slow-moving inventory indicators

The dashboard should prioritize operational action over decorative analytics.

## 5. Workflow Design

### 5.1 Seller acquisition workflow

1. Staff receives a seller inquiry externally.
2. Staff manually encodes the inquiry as a seller lead.
3. Seller contact information and offered vehicle details are captured.
4. A follow-up is scheduled.
5. Lead progress is updated through inspection and negotiation stages.
6. If the vehicle is acquired, a vehicle record is created and linked to the seller lead.
7. The seller lead is closed as `Purchased` or `Rejected`.

### 5.2 Vehicle inventory workflow

1. A vehicle is acquired or endorsed to the dealership.
2. A vehicle record is created.
3. Photos, specifications, remarks, and pricing are added.
4. The unit moves through `Incoming`, `Reconditioning`, `Available`, `Reserved`, and `Sold` as applicable.
5. When sold, the vehicle is linked to a finalized sale record.

### 5.3 Buyer sales workflow

1. Staff receives a buyer inquiry externally.
2. Staff manually encodes the inquiry as a buyer lead.
3. The buyer lead is linked to one or more vehicles.
4. Communication history and follow-ups are recorded.
5. The buyer progresses through negotiation and reservation stages.
6. When a sale closes, the buyer lead is marked `Won` and the vehicle is marked `Sold`.
7. If the deal is not completed, the buyer lead is marked `Lost` with a closing reason.

### 5.4 Agent commission workflow

1. A sale is completed.
2. An agent may be assigned if the sale was agent-assisted.
3. The system applies a default commission rule.
4. Staff or admin may override the default commission if necessary.
5. An override reason is required.
6. The finalized commission remains historically visible for audit and review.

## 6. Business Rules and Controls

### 6.1 Lead controls

- Seller and buyer leads must have required core fields before leaving `New Inquiry`.
- Every lead must have an assignee.
- Every lead must maintain a latest activity timestamp.
- A lead may have multiple follow-ups historically, but the interface should clearly highlight one next due action.
- Terminal states such as `Purchased`, `Rejected`, `Won`, and `Lost` require a closing note or reason.

### 6.2 Inventory controls

- A vehicle cannot move to `Available` until minimum required fields are complete.
- Minimum required fields for `Available` should include key specs, pricing, and at least one photo.
- A vehicle cannot move to `Sold` without a linked sale record.
- A vehicle marked `Reserved` should link to a buyer lead or explicit reservation note.

### 6.3 Sales and commission controls

- A sale record must include sale date and final sale amount.
- Agent assignment is optional, but if present, commission data becomes required.
- The system should apply a default commission rule and permit manual override.
- Manual commission override requires a reason.
- Once a sale is finalized, key financial values should be locked for ordinary staff and editable only by an administrator.

### 6.4 Operational controls

- Important status changes should create activity log entries.
- Notes and historical actions should be searchable.
- Dashboard ordering should emphasize overdue and due-today operational work.
- Record detail pages should preserve enough history to reconstruct business decisions without checking Messenger threads.

## 7. Information Architecture

### 7.1 Main navigation

Recommended primary navigation:
- Dashboard
- Vehicles
- Seller Leads
- Buyer Leads
- Follow-Ups
- Sales
- Reports
- Users / Roles

### 7.2 Dashboard-first behavior

The dashboard should be the first screen after login. It should answer:
- what needs follow-up now
- what new inquiries entered the pipeline
- which vehicles are available, reserved, or sold
- how the current month is performing

### 7.3 Record detail pages

Each major record page should include:
- summary panel
- editable core details
- current stage or status
- notes and activity history
- related records
- next action or follow-up area

## 8. Suggested Technical Architecture

### 8.1 Application split

The current workspace suggests a clean split:
- frontend application in `etc-cars`
- backend API in `etc-api`

Recommended implementation shape:
- `etc-cars`: Next.js internal web application
- `etc-api`: NestJS API
- relational database for core transactional records
- object/file storage for vehicle photos and future attachments

### 8.2 Why this architecture fits

This system has strongly related business records and reporting requirements. A relational backend is the right base because:
- seller, buyer, vehicle, sale, and commission data are linked
- workflow controls belong in the backend
- dashboard metrics should come from structured data, not UI-only logic
- future growth can add portals, notifications, and public listings without changing the domain core

## 9. Suggested Domain Model

Recommended initial entities:
- `users`
- `roles`
- `vehicles`
- `vehicle_photos`
- `seller_leads`
- `buyer_leads`
- `lead_vehicle_links`
- `lead_activities`
- `follow_ups`
- `sales`
- `commissions`

Recommended relationships:
- one seller lead may convert into one vehicle
- one buyer lead may reference one or more vehicles
- one vehicle may have one final sale
- one sale may optionally reference one agent attribution record or agent identity field
- one sale should have one commission record in MVP
- follow-ups belong to either seller leads or buyer leads

## 10. Security and Access

Authentication and role-based access should be included from day one.

MVP security requirements:
- secure login for owner/admin and staff
- role-based route and action control
- password storage using standard secure hashing
- session or token-based authentication suitable for an internal web app
- audit visibility for sensitive financial changes

Role model for MVP:
- `admin`
- `staff`

An `agent` role should be deferred until the future self-service portal phase unless later MVP requirements clearly justify it.

## 11. Reporting Requirements

The first reporting layer should focus on operational visibility instead of advanced BI.

Core reports and metrics:
- total available inventory
- reserved inventory
- sold inventory
- monthly sales count
- monthly revenue
- monthly profit
- follow-ups due and overdue
- top-performing models
- slow-moving inventory
- lead pipeline counts by status

## 12. Out of Scope for MVP

The following features are explicitly excluded from the first implementation plan:
- Messenger integration
- Facebook Marketplace integration
- public listings website
- SMS reminders
- email automation
- agent self-service login
- advanced analytics such as conversion funnels beyond basic operational reporting
- document management for OR/CR and similar attachments beyond basic photo/file support

## 13. Success Criteria

The MVP should be considered successful if:
- seller inquiries are consistently encoded and tracked
- buyer inquiries are consistently encoded and followed up
- vehicle inventory is centralized and reliable
- follow-up work is visible, scheduled, and monitored
- completed sales are digitized and searchable
- commission review becomes faster and clearer
- the owner can monitor operations from the dashboard without reconstructing records from chat histories

## 14. Open Implementation Notes

The implementation plan should pay special attention to:
- schema design for linked operational records
- practical data-entry speed for manual intake
- dashboard query performance
- auditability of status and financial changes
- storage and display strategy for vehicle photos
- migration path from current manual records into the system
