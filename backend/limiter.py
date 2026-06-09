import time
from typing import Optional
from fastapi import HTTPException
try:
    from cache import cache
except ImportError:
    cache = None

def check_rate_limit(key: str, limit: int, window: int) -> bool:
    """
    Checks if the given key has exceeded the rate limit.
    Returns True if allowed, False if blocked.
    """
    if not cache:
        return True

    # 1. Redis active backend
    if cache.client:
        try:
            redis_key = f"rate:{key}"
            pipe = cache.client.pipeline()
            pipe.incr(redis_key)
            pipe.ttl(redis_key)
            current_hits, current_ttl = pipe.execute()
            
            # If new key (TTL not set yet), set expiration
            if current_ttl < 0:
                cache.client.expire(redis_key, window)
            
            if current_hits > limit:
                return False
            return True
        except Exception as e:
            print(f"Redis rate limiter fallback to local memory: {e}")
            
    # 2. Local memory fallback
    now = time.time()
    local_key = f"rate:{key}"
    timestamps = cache.get(local_key)
    if not isinstance(timestamps, list):
        timestamps = []
        
    cutoff = now - window
    timestamps = [t for t in timestamps if t > cutoff]
    
    if len(timestamps) >= limit:
        return False
        
    timestamps.append(now)
    cache.set(local_key, timestamps, expire=window)
    return True

def verify_rate_limit(key: str, limit: int, window: int, detail: str = "Too many requests. Please try again later."):
    """
    Raises HTTP 429 exception if rate limit is exceeded.
    """
    if not check_rate_limit(key, limit, window):
        raise HTTPException(
            status_code=429,
            detail=detail
        )
