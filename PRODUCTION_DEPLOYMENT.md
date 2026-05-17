# NotePay — Production Deployment Guide

## Security & Deployment Checklist

### 1. Environment Configuration

#### Backend (.env)
```bash
# Environment
ENVIRONMENT=production

# Firebase
FIREBASE_PROJECT_ID=notepay-de2b0

# Database
DATABASE_URL=postgresql://user:password@hostname:5432/notepay
# OR for SQLite (development only):
# DATABASE_URL=sqlite:///./notepay.db

# Redis (for caching and rate limiting)
REDIS_URL=redis://user:password@hostname:6379/0

# CORS
ALLOWED_ORIGINS=https://notepay.example.com,https://www.notepay.example.com

# Server
HOST=0.0.0.0
PORT=8000

# SSL/TLS
ENABLE_HTTPS=true
SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem
```

#### Frontend (.env or config)
```javascript
// firebase-config.js
const API_BASE = 'https://api.notepay.example.com'; // Use HTTPS
```

### 2. Database Security

#### PostgreSQL (Recommended for Production)
```bash
# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Create database and user
sudo -u postgres createdb notepay
sudo -u postgres createuser notepay_user
sudo -u postgres psql

# Set permissions
ALTER USER notepay_user WITH PASSWORD 'strong_password_here';
ALTER ROLE notepay_user CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE notepay TO notepay_user;
```

#### Enable SSL for Database Connection
```bash
# Update DATABASE_URL to use SSL
DATABASE_URL=postgresql://user:password@hostname:5432/notepay?sslmode=require
```

### 3. Redis Setup for Rate Limiting

```bash
# Install Redis
sudo apt-get install redis-server

# Enable SSL/TLS (production)
# Edit /etc/redis/redis.conf
port 0
tls-port 6379
tls-cert-file /path/to/cert.pem
tls-key-file /path/to/key.pem
tls-ca-cert-file /path/to/ca.pem

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Connection URL with SSL
REDIS_URL=rediss://default:password@hostname:6379/0
```

### 4. Firebase Security

#### Production Firebase Project
1. Go to Firebase Console: https://console.firebase.google.com
2. Create a production project
3. Configure authentication:
   - Enable Phone authentication
   - Set reCAPTCHA enterprise
   - Configure test numbers only for staging

#### Download Service Account Key
1. Go to Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Save as `service_account.json` (DO NOT commit to Git)
4. Add to `.gitignore`

#### Update Firebase Config (Frontend)
```javascript
// Use production Firebase config
const firebaseConfig = {
  apiKey: "YOUR_PRODUCTION_API_KEY",
  authDomain: "your-project-prod.firebaseapp.com",
  projectId: "your-project-prod",
  storageBucket: "your-project-prod.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 5. HTTPS/SSL Configuration

#### Using Let's Encrypt with Certbot
```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d notepay.example.com -d api.notepay.example.com

# Certificate will be at:
# /etc/letsencrypt/live/notepay.example.com/
# cert.pem (fullchain.pem)
# privkey.pem
```

#### Enable HTTPS in Backend
```python
# main.py
os.getenv("ENABLE_HTTPS", "false").lower() == "true"

# Or use Uvicorn with SSL
uvicorn main:app --host 0.0.0.0 --port 8000 \
  --ssl-certfile=/path/to/cert.pem \
  --ssl-keyfile=/path/to/key.pem
```

### 6. Rate Limiting & DDoS Protection

#### OTP Verification Rate Limit
- **Max 5 attempts per phone number**
- **Time window: 1 hour**
- Implemented in: `cache.py` + `login.html`

#### Event Join Rate Limit
- **Max 50 join attempts per user per hour**
- **Prevents IDOR attacks**
- Implemented in: `/events/join` endpoint

#### General API Rate Limiting (Optional)
```bash
# Install nginx
sudo apt-get install nginx

# Configure nginx rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;

# In server block:
location /api/ {
  limit_req zone=api_limit burst=200 nodelay;
  proxy_pass http://backend:8000;
}
```

### 7. Deployment with Docker

#### Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

ENV ENVIRONMENT=production
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### Docker Compose
```yaml
version: '3.9'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/notepay
      REDIS_URL: redis://redis:6379/0
      ENVIRONMENT: production
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend/service_account.json:/app/service_account.json:ro

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: notepay
      POSTGRES_USER: user
      POSTGRES_PASSWORD: strong_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 8. Monitoring & Logging

#### Enable Application Logging
```python
# main.py already includes:
# - RequestLoggingMiddleware (all requests)
# - Global exception handler (error logging)

# Configure logging
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/notepay/app.log'),
        logging.StreamHandler()
    ]
)
```

#### Health Check Endpoint
```bash
# Provided endpoint: GET /health
curl https://api.notepay.example.com/health

# Expected response:
# {"status": "healthy", "version": "1.0.0", "timestamp": "2024-..."}
```

### 9. Security Headers (Already Implemented)

The following security headers are automatically added:
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: [configured]
```

### 10. Input Validation & Sanitization

#### Implemented Validations
- ✅ Event name: max 200 chars, not empty
- ✅ Event description: max 2000 chars
- ✅ Donor name: max 200 chars, not empty
- ✅ Expense description: max 500 chars, not empty
- ✅ Amount validation: 0-10,000,000
- ✅ Invite code validation: alphanumeric only
- ✅ Phone number validation: 10 digits (India)

### 11. IDOR & Authorization

#### Implemented Protections
- ✅ Restricted members cannot access event data
- ✅ Restricted members cannot be promoted to organizer
- ✅ Role-based access control on all endpoints
- ✅ Rate limiting prevents brute force attacks
- ✅ Membership verification on all operations

#### Restricted Member Logic
- When restricted: role → collector (automatic demotion)
- Restricted status checked BEFORE role
- Shown in "Shared Events" tab only
- Cannot perform any read/write operations

### 12. Deployment Steps

1. **Set up infrastructure**
   ```bash
   # Create VM/server instance
   # Install PostgreSQL, Redis, Node.js/Python
   # Configure firewall (only 80, 443, 22)
   ```

2. **Deploy backend**
   ```bash
   cd backend
   pip install -r requirements.txt
   
   # Set environment variables
   export DATABASE_URL=postgresql://...
   export REDIS_URL=redis://...
   export ENVIRONMENT=production
   
   # Run with production server (e.g., Gunicorn)
   gunicorn main:app -w 4 -b 0.0.0.0:8000 --ssl-certfile=... --ssl-keyfile=...
   ```

3. **Deploy frontend**
   ```bash
   # Static file hosting (CDN or web server)
   # Update firebase-config.js with production values
   # Serve via HTTPS
   ```

4. **SSL Certificate**
   ```bash
   # Auto-renew with cron
   0 2 1 * * certbot renew --quiet
   ```

5. **Backup & Recovery**
   ```bash
   # Regular database backups
   0 3 * * * pg_dump postgresql://... | gzip > /backups/notepay_$(date +%Y%m%d).sql.gz
   ```

### 13. Performance Optimization

- ✅ Caching layer (Redis)
- ✅ Database connection pooling
- ✅ WebSocket for real-time updates
- ✅ Compressed responses
- ✅ CDN for static assets

### 14. Monitoring Checklist

- [ ] Set up application monitoring (e.g., Sentry)
- [ ] Configure error alerting
- [ ] Monitor database performance
- [ ] Track API response times
- [ ] Monitor cache hit rates
- [ ] Set up log aggregation
- [ ] Configure uptime monitoring

### 15. Incident Response

#### In Case of Breach/Unauthorized Access
1. Immediately rotate Firebase credentials
2. Reset OTP rate limits
3. Review audit logs
4. Disable affected user accounts
5. Notify users

#### Emergency Procedures
- Database failover strategy
- Backup restoration procedure
- Service rollback plan

---

## Testing Checklist

- [ ] Test all authentication flows
- [ ] Verify rate limiting (OTP, joins)
- [ ] Test restricted member access
- [ ] Verify role-based access control
- [ ] Load test API endpoints
- [ ] Test database failover
- [ ] Verify backup/restore process
- [ ] Test SSL certificate renewal

---

## Maintenance

### Regular Tasks
- Daily: Monitor logs and alerts
- Weekly: Review security logs
- Monthly: Update dependencies
- Quarterly: Security audit
- Yearly: Penetration testing

### Certificate Renewal
- Let's Encrypt certificates expire after 90 days
- Automated renewal via certbot (see above)
- Manual verification: `certbot renew --dry-run`

---

## Support & Documentation

- **API Docs**: `/docs` (Swagger UI)
- **Health Status**: `/health`
- **Version Info**: `/api/version`

For more information, see README.md and contributing guidelines.
