# 🌐 Jai'fore

A full-stack digital platform built to support the **Jai'fore** brand, combining a responsive customer-facing experience with backend services for authentication, products, orders, payments, transactions, users, and business operations.

🌐 **Live Website:**
https://jai-fore-website.vercel.app

---

## 🚀 Project Overview

Jai'fore is a full-stack web application designed around the idea of building a scalable digital ecosystem rather than a static business website.

The project separates the customer-facing frontend from a Node.js/Express backend while connecting application services through REST APIs.

The platform includes authentication, product and order infrastructure, transaction management, payment-related functionality, user management, print pricing, email services, monitoring, and administrative functionality.

---

## ✨ Key Features

### 🌐 Customer-Facing Website

* Responsive navigation
* Modern branded interface
* About and services sections
* Interactive user experience
* Mobile-friendly layout
* Customer calls-to-action
* Dedicated service pages

### 🔐 Authentication & Security

* User authentication
* JWT-based authorization
* Password hashing with bcrypt
* Protected API functionality
* CORS restrictions
* API rate limiting
* Separate limits for authentication and payment-sensitive requests

### 📦 Product & Order Infrastructure

Backend services support:

* Products
* Orders
* Order processing
* Payment verification
* Transaction records
* User management

### 💳 Transactions & Payments

The backend contains dedicated infrastructure for:

* Orders
* Payment-related operations
* Transaction management
* Payment verification

Sensitive payment operations receive stricter API rate limiting.

### 👥 User Management

Dedicated backend routes support user-related functionality while authentication services control access to protected application resources.

### 🖨️ Print Pricing

Jai'fore includes dedicated API functionality for print-pricing services, extending the platform beyond a standard storefront.

### 📧 Communication Services

The backend integrates email infrastructure using:

* Nodemailer
* Resend

### 📊 Monitoring & Reliability

Sentry is integrated for backend error monitoring and application diagnostics.

The server also implements structured error handling so unexpected failures return controlled responses instead of exposing internal application details.

---

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript
* Responsive Web Design

### Backend

* Node.js
* Express.js
* REST APIs
* JWT
* bcrypt
* Axios
* Express Rate Limit

### Database & Infrastructure

* PostgreSQL
* Redis / ioredis
* Environment Variables

### Communication & Monitoring

* Nodemailer
* Resend
* Sentry

### Deployment & Development

* Git
* GitHub
* Vercel
* Nodemon

---

## 🏗️ Architecture

```text
Users
  │
  ▼
Jai'fore Frontend
HTML / CSS / JavaScript
  │
  │ REST API
  ▼
Node.js + Express Backend
  │
  ├── Authentication
  ├── Products
  ├── Orders
  ├── Payments
  ├── Transactions
  ├── Users
  ├── Print Pricing
  └── Backup Services
  │
  ├──────────────► Email Services
  │
  ├──────────────► Redis
  │
  ▼
PostgreSQL
```

---

## 📁 Project Structure

```text
jaifore/
│
├── frontend/
│   ├── index.html
│   ├── services.html
│   ├── styles/
│   ├── logo/
│   └── admin/
│
├── backend/
│   ├── server.js
│   ├── database.js
│   ├── auth.js
│   ├── routes/
│   ├── images/
│   └── package.json
│
└── README.md
```

---

## 🔌 API Structure

The backend organizes application functionality into dedicated API routes:

```text
/api/auth
/api/orders
/api/products
/api/transactions
/api/users
/api/print-pricing
/api/backup
```

This keeps different areas of the application separated and easier to maintain.

---

## 🛡️ Security Measures

The application implements several backend security practices:

* Password hashing
* JWT authentication
* Environment-based configuration
* Restricted CORS origins
* Authentication rate limiting
* Payment request rate limiting
* General API rate limiting
* Controlled error responses
* Monitoring through Sentry

Sensitive credentials and production secrets should always remain outside the repository through environment variables.

---

## ⚙️ Running Locally

Clone the repository:

```bash
git clone https://github.com/movffasea-byte/jaifore.git
```

Enter the project:

```bash
cd jaifore
```

Install backend dependencies:

```bash
cd backend
npm install
```

Create the required `.env` configuration for your local environment.

Then start the development server:

```bash
npm run dev
```

---

## 🧠 Engineering Concepts Demonstrated

This project demonstrates experience with:

* Full-stack application architecture
* REST API development
* PostgreSQL
* Authentication and authorization
* Password security
* API middleware
* Rate limiting
* CORS configuration
* Payment workflows
* Transaction management
* Redis integration
* Email services
* Error monitoring
* Production error handling
* Responsive frontend development
* Deployment and environment configuration

---

## 🔮 Future Improvements

* Automated API and frontend testing
* Continuous integration
* Expanded analytics
* Improved accessibility
* More granular authorization
* API documentation
* Additional monitoring dashboards
* Improved automated deployment workflows

---

## 👨‍💻 Developer

**Gaba Abraham**

Full-Stack Developer / Software Engineer

GitHub: **@movffasea-byte**

---

## 📄 Project Status

Jai'fore is an actively developed full-stack platform.

⭐ This repository is part of my professional software development portfolio.
