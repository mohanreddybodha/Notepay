import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from dotenv import load_dotenv

load_dotenv()

# Using SQLite for development
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./notepay_dev_v2.db")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

if ENVIRONMENT == "production" and "sqlite" in SQLALCHEMY_DATABASE_URL:
    raise RuntimeError("FATAL: SQLite fallback is strictly prohibited in production. A valid Postgres DATABASE_URL must be provided.")

if "sqlite" in SQLALCHEMY_DATABASE_URL:
    # Local development uses SQLite
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, 
        connect_args={"check_same_thread": False}
    )
    # Enable WAL mode and normal synchronization to bypass OneDrive write lock latencies
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
else:
    # Production uses Neon PostgreSQL. We use a tuned QueuePool (pool_size=1) 
    # to maintain exactly 1 persistent connection per AWS Lambda container,
    # eliminating the 200ms TLS handshake per query while avoiding DB connection exhaustion.
    from sqlalchemy.pool import QueuePool
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=2,
        pool_pre_ping=True
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
