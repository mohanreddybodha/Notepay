"""Add verified UPI owner metadata to events.

Revision ID: 8a9d2b3c4e5f
Revises: 7f8c1a2b3d4e
Create Date: 2026-06-12 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8a9d2b3c4e5f"
down_revision: Union[str, None] = "7f8c1a2b3d4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("upi_owner_name", sa.String(), nullable=True))
    op.add_column("events", sa.Column("upi_verified_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "upi_verified_at")
    op.drop_column("events", "upi_owner_name")
