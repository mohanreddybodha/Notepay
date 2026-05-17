import os
import json
import time
from typing import Any, Optional

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    print("⚠️ Redis module not found. Caching will use in-memory fallback.")

# Cache configuration
REDIS_URL = os.getenv("REDIS_URL")

class CacheManager:
    def __init__(self):
        self.client = None
        self._local_cache = {} # Fallback for local development
        
        if REDIS_URL and REDIS_AVAILABLE:
            try:
                self.client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=1.0)
                print(f"Connected to Redis at {REDIS_URL} (with timeout)")
            except Exception as e:
                print(f"Redis connection failed: {e}. Falling back to in-memory.")

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a value from the cache."""
        if self.client:
            try:
                val = self.client.get(key)
                return json.loads(val) if val else None
            except Exception as e:
                print(f"Cache get error: {e}")
                return None
        
        # Local fallback with proper expiration check
        if key in self._local_cache:
            val, expire_at = self._local_cache[key]
            if time.time() < expire_at:
                return val
            else:
                del self._local_cache[key]
        return None

    def set(self, key: str, value: Any, expire: int = 3600):
        """Save a value to the cache with an expiration time (default 1 hour)."""
        if self.client:
            try:
                self.client.set(key, json.dumps(value), ex=expire)
            except Exception as e:
                print(f"Cache set error: {e}")
        else:
            # Skip real-time full details cache when running in-memory fallback to prevent multi-worker split-brain issues
            if key.startswith("full:"):
                return
            self._local_cache[key] = (value, time.time() + expire)

    def delete(self, key: str):
        """Remove a specific key from the cache."""
        if self.client:
            try:
                self.client.delete(key)
            except Exception as e:
                print(f"Cache delete error: {e}")
        else:
            if key in self._local_cache:
                del self._local_cache[key]

    def invalidate_event(self, event_id: int):
        """Clears all cached data related to a specific event."""
        self.delete(f"sum:{event_id}")
        self.delete(f"all:{event_id}")
        
        # Also clear all user-specific "Big Bang" caches for this event
        if self.client:
            try:
                # Redis pattern match
                keys = self.client.keys(f"full:{event_id}:*")
                if keys:
                    self.client.delete(*keys)
            except Exception as e:
                print(f"Redis pattern invalidate error: {e}")
        else:
            # Local cache pattern match
            prefix = f"full:{event_id}:"
            to_del = [k for k in self._local_cache.keys() if k.startswith(prefix)]
            for k in to_del:
                del self._local_cache[k]
        print(f"🧹 Cache Fully Cleared for Event {event_id}")

    def get_global_version(self) -> str:
        """Returns the current global dashboard version (heartbeat)."""
        if self.client:
            try:
                return self.client.get("dash_v") or "1"
            except: return "1"
        return str(self._local_cache.get("dash_v", "1"))

    def bump_global_version(self):
        """Increments the global dashboard version, forcing all users to fetch fresh data."""
        if self.client:
            try:
                self.client.incr("dash_v")
                print("💓 Global Dashboard Version Bumped (Real-time Sync)")
            except: pass
        else:
            v = int(self._local_cache.get("dash_v", "1"))
            self._local_cache["dash_v"] = str(v + 1)

# Create a singleton instance
cache = CacheManager()
