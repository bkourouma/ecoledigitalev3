// Database configuration for EcoleDigitale API
// This file is used when .env cannot be created

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:DevMick%402003@localhost:5432/dbecoledigitale",
  PORT: process.env.PORT || 4000,
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production",
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "your-secret-key-here-change-in-production"
};


