# NotePay — Security Best Practices & Threat Mitigation

## Overview

This document outlines the security measures implemented in NotePay to protect user data and prevent common attacks.

---

## 1. Authentication & Authorization

### Implementation
- **Firebase Phone Authentication**: Industry-standard OTP verification
- **JWT Tokens**: Secure, time-limited tokens for API access
- **Token Caching**: 10-minute cache reduces Firebase verification overhead

### OTP Rate Limiting (NEW)
```
- Maximum 5 failed verification attempts per phone number
- 1-hour lockout window
- Attempts tracked in frontend localStorage
- Backend validates and enforces limits
```

#### How It Works
1. User enters phone number
2. OTP sent via Firebase
3. User has max 5 attempts to enter correct OTP
4. After 5 failures: "Too many attempts" error
5. User must request new OTP (via resend)
6. Counter resets when OTP is resent

### Token Verification
```
- Every API request requires Bearer token
- Tokens verified against Firebase
- Invalid/expired tokens → 401 Unauthorized
- Session redirects to login.html
```

---

## 2. IDOR (Insecure Direct Object Reference) Prevention

### Implementation
- **Membership verification**: All event operations verify membership first
- **Role-based access control**: Only organizers can manage events
- **Restricted members blocked**: Restricted status checked BEFORE role

### Rate Limiting for Joins
```
- Maximum 50 event joins per user per hour
- Prevents brute force attempts to find events
- Tracked in Redis/in-memory cache
- Returns 429 Too Many Requests if exceeded
```

#### Attack Prevention
- Attacker cannot repeatedly guess event codes
- Each failed join counts toward rate limit
- After 50 attempts: locked out for 1 hour

---

## 3. Restricted Member Security (NEW)

### Problem Statement
Previously, restricting a member didn't prevent them from accessing data if they had an organizer role.

### Solution Implemented
1. **Priority System**: `is_restricted` checked BEFORE role
2. **Automatic Demotion**: Organizers demoted to collectors when restricted
3. **Promotion Prevention**: Cannot promote restricted members to organizer
4. **Access Denial**: Restricted members cannot perform ANY operations

### Database Schema
```sql
EventMember
├── user_id
├── event_id
├── role (organizer | collector)
├── is_restricted BOOLEAN  -- ← Checked first
├── restricted_at TIMESTAMP
```

### Verification Order
```
1. Check if member exists → if not, deny access
2. Check if is_restricted=true → if yes, deny ALL access
3. Check role (organizer/collector) → allow based on role
```

### UI/UX Implications
- Restricted events show in "Shared Events" with locked icon
- Cannot open restricted events
- Organizers see restricted badge on member list
- Clear error message when trying to access

---

## 4. Input Validation & Sanitization

### Event Creation
```
✓ Name: 1-200 characters, no empty
✓ Description: max 2000 characters
✓ Event Date: must be in future
```

### Donations
```
✓ Donor Name: 1-200 characters, no empty
✓ Amount: 0 to 10,000,000
✓ Custom Fields: validated as JSON
```

### Expenses
```
✓ Description: 1-500 characters, no empty
✓ Amount: 0 to 10,000,000
```

### Invite Codes
```
✓ Format: 8 characters, alphanumeric only
✓ No special characters allowed
✓ Prevents injection attacks
```

---

## 5. Database Security

### Connection Security
- **Production**: PostgreSQL with SSL/TLS
- **Development**: SQLite (local only)
- **Connection pooling**: SQLAlchemy session management
- **Parameterized queries**: All ORM queries prevent SQL injection

### Data Isolation
```
- Users only see their own profile
- Event members only see event data
- No cross-user data leakage
- Organizers see all event members
```

### Sensitive Data
```
✗ Passwords: Not stored (Firebase Auth)
✗ OTP codes: Never transmitted
✗ Phone numbers: Only shared within event members
✗ Firebase UID: Hashed before logging
```

---

## 6. API Security

### Authentication
```
Every request requires:
- Authorization: Bearer <id_token>
- Token must be valid (verified with Firebase)
- Token must not be expired
```

### Rate Limiting (Implemented)
| Endpoint | Limit | Window |
|----------|-------|--------|
| OTP Entry | 5 attempts | 1 hour |
| Event Join | 50 attempts | 1 hour |
| General API | 100 req/sec | Per IP |

### HTTP Status Codes
```
200 OK - Success
400 Bad Request - Invalid input
401 Unauthorized - Auth required
403 Forbidden - Access denied
404 Not Found - Resource not found
429 Too Many Requests - Rate limited
500 Internal Error - Server error
```

---

## 7. Session Management

### Token Lifecycle
```
1. User logs in via Firebase OTP
2. Firebase issues ID token
3. Token sent to backend in Authorization header
4. Backend caches verified token (10 min)
5. All subsequent requests use same token
6. Token auto-refreshes when expired (Firebase handles)
7. Logout clears Firebase session
```

### Session Storage
```
Frontend:
- Firebase session (managed by Firebase SDK)
- localStorage: OTP attempt counter only

Backend:
- Redis cache: Verified tokens
- Database: User records and memberships
```

### Session Timeout
```
- Inactive timeout: 24 hours (Firebase default)
- Token expiry: 1 hour (Firebase ID tokens)
- Auto-refresh: Transparent to user
- Login required: Only if session fully expired
```

---

## 8. Communication Security

### HTTPS/TLS
```
✓ All traffic encrypted
✓ Certificate pinning (recommended for mobile)
✓ Valid certificate from trusted CA
✓ Certificate auto-renewal (Let's Encrypt)
```

### Security Headers (Implemented)
```
X-Frame-Options: DENY
  → Prevents clickjacking

X-Content-Type-Options: nosniff
  → Prevents MIME sniffing

X-XSS-Protection: 1; mode=block
  → Basic XSS protection

Strict-Transport-Security: max-age=31536000
  → Forces HTTPS for 1 year

Referrer-Policy: strict-origin-when-cross-origin
  → Controls referrer information

Content-Security-Policy: [restrictive policy]
  → Prevents inline scripts, external resources
```

### CORS Configuration
```
Allowed Origins:
- http://localhost:5500
- http://localhost:8000
- Production domains (via environment)

Methods: GET, POST, PUT, DELETE, OPTIONS
Headers: All (Content-Type, Authorization, etc.)
Credentials: Allowed
```

---

## 9. Logging & Monitoring

### Request Logging
```
Every request logged with:
- Client IP address
- HTTP method (GET, POST, etc.)
- Request path
- HTTP status code
- Timestamp
```

### Error Logging
```
All exceptions logged with:
- Error type
- Error message
- Stack trace
- Request context
```

### Security Events
```
✓ Failed authentication attempts
✓ Rate limit violations
✓ Unauthorized access attempts
✓ Member restriction/unrestriction
✓ Role changes
✓ Event deletion
```

### Log Retention
```
Development: Console output
Production: File + external service (e.g., Sentry)
Retention: 90 days minimum
Encryption: At rest (if possible)
Access: Admin only
```

---

## 10. Data Privacy

### GDPR Compliance
- Users can view their own data via `/users/me`
- Users can delete account (via Firebase)
- Users can export their data (future feature)
- Right to be forgotten: Delete account removes all related data

### Data Minimization
```
Collected:
✓ Phone number (authentication)
✓ Full name (public display)
✓ Gender (optional, for personalization)

NOT collected:
✗ Location data
✗ Device identifiers
✗ Browsing history
✗ IP addresses (except for logging)
```

---

## 11. Dependency Security

### Dependencies to Monitor
```
Critical:
- fastapi (API framework)
- sqlalchemy (ORM)
- firebase-admin (Authentication)
- redis (Caching)

Regular Updates:
- Check for CVEs monthly
- Use `pip audit` to scan
- Run `dependabot` on GitHub
```

### Vulnerable Packages
```
✓ Removed: sqlite3 (development only)
✓ Removed: debug middleware (production)
✓ Updated: All packages to latest versions
```

---

## 12. Threat Models & Mitigations

### Threat 1: Unauthorized Event Access (IDOR)
**Attack**: Guess event IDs to access other user's events
**Mitigation**: 
- Membership verification on all endpoints
- UUID invite codes (not sequential IDs)
- Rate limiting on joins
- Randomized code generation

### Threat 2: OTP Brute Force
**Attack**: Try all 6-digit OTP codes (1M combinations)
**Mitigation**:
- Max 5 attempts per phone (1% chance of brute force)
- 1-hour lockout after failures
- Firebase rate limiting (additional protection)
- reCAPTCHA on phone entry

### Threat 3: Member Privilege Escalation
**Attack**: Restricted member still has organizer access
**Mitigation**:
- Automatic demotion to collector
- Restricted status checked FIRST
- Cannot promote restricted members
- Access verification at every operation

### Threat 4: SQL Injection
**Attack**: Malicious SQL in user input
**Mitigation**:
- SQLAlchemy ORM (parameterized queries)
- Input validation on all fields
- No raw SQL queries
- Regular security audits

### Threat 5: Cross-Site Scripting (XSS)
**Attack**: Inject malicious scripts into HTML
**Mitigation**:
- Content Security Policy header
- Input sanitization
- No innerHTML usage in critical code
- Framework-level protections

### Threat 6: Session Hijacking
**Attack**: Steal authentication token
**Mitigation**:
- HTTPS only (in production)
- Token in header (not cookie)
- Short token lifetime (1 hour)
- Token rotation on refresh
- Secure storage in Firebase

### Threat 7: DDoS Attack
**Attack**: Overwhelming API with requests
**Mitigation**:
- Rate limiting per IP/user
- nginx reverse proxy with throttling
- Connection pooling
- Auto-scaling (if cloud-hosted)

---

## 13. Security Testing

### Manual Testing
```
1. OTP Rate Limiting
   - Try 6+ wrong codes → should fail
   - Resend OTP → counter resets

2. IDOR Testing
   - Access event without joining → denied
   - Try to modify other user's donations → denied

3. Restricted Member Access
   - Restrict a member → event appears locked
   - Try to access → denied
   - Try to promote → rejected
```

### Automated Testing
```
# SQL Injection testing
payload = "'; DROP TABLE users; --"
# System rejects with validation error

# XSS testing
payload = "<img src=x onerror=alert('XSS')>"
# Sanitized and stored as plain text

# CSRF testing
# POST without CSRF token → rejected
```

### Security Scanning
```
# Install security scanner
pip install bandit
bandit -r backend/

# Check for known vulnerabilities
pip audit

# OWASP dependency check
# Run via CI/CD pipeline
```

---

## 14. Incident Response Plan

### Step 1: Detection
- Monitor logs for suspicious activity
- Set up alerts for rate limit triggers
- Review failed authentication logs

### Step 2: Containment
```
If OTP rate limit triggered:
- Notify user
- Lock account for 1 hour
- Force password reset via Firebase

If unauthorized access detected:
- Block user session
- Notify organizers
- Audit affected events
```

### Step 3: Investigation
```
1. Review access logs for affected user
2. Check for data modifications
3. Identify entry point
4. Determine scope of compromise
```

### Step 4: Recovery
```
1. Restore from backup if needed
2. Reset affected user accounts
3. Force re-authentication
4. Notify affected users
5. Implement preventative measures
```

### Step 5: Post-Incident
```
1. Document what happened
2. Identify root cause
3. Implement fixes
4. Update security policies
5. Conduct lessons learned meeting
```

---

## 15. Compliance & Standards

### Standards Followed
- OWASP Top 10 mitigations
- GDPR data protection
- NIST Cybersecurity Framework
- PCI DSS (for payment processing, future)

### Certifications (Optional)
- SOC 2 Type II
- ISO 27001
- HIPAA (if handling health data)

---

## 16. Security Checklist for Deployment

- [ ] Enable HTTPS/TLS
- [ ] Configure firewall rules
- [ ] Set strong database passwords
- [ ] Enable Redis authentication
- [ ] Configure CORS properly
- [ ] Set environment variables
- [ ] Enable audit logging
- [ ] Configure backups
- [ ] Test disaster recovery
- [ ] Set up monitoring
- [ ] Enable rate limiting
- [ ] Review security headers
- [ ] Scan for vulnerabilities
- [ ] Conduct security audit
- [ ] Update documentation

---

## 17. Security Contact & Reporting

### Responsible Disclosure
If you discover a security vulnerability:
1. DO NOT post publicly
2. Email: security@notepay.example.com
3. Include: Description, reproduction steps, impact
4. We will respond within 48 hours

### Bug Bounty (Optional)
- We offer rewards for validated security reports
- Details at: https://notepay.example.com/security

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-05-16 | Initial document with all security features |
| 1.1 | 2024-06-01 | Added incident response plan |
| 1.2 | 2024-07-01 | Updated rate limiting details |

---

**Last Updated**: May 16, 2024
**Next Review**: August 16, 2024
**Responsible**: Security Team
