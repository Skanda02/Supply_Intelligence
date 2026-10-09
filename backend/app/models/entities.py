"""SQLAlchemy entities for MedPredict 7-table MVP schema."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.core.database import Base


def utcnow():
    return datetime.now(UTC)


class Hospital(Base):
    __tablename__ = "hospitals"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    city = Column(String(100), nullable=True)
    bed_capacity = Column(Integer, default=0)
    avg_daily_patients = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    inventory_batches = relationship("InventoryBatch", back_populates="hospital")
    demand_records = relationship("DemandHistory", back_populates="hospital")
    purchase_orders = relationship("PurchaseOrder", back_populates="hospital")


class Medicine(Base):
    __tablename__ = "medicines"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False)
    unit = Column(String(50), nullable=False)
    criticality_level = Column(String(50), nullable=False)  # LOW, MEDIUM, HIGH, CRITICAL
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    inventory_batches = relationship("InventoryBatch", back_populates="medicine")
    demand_records = relationship("DemandHistory", back_populates="medicine")
    supplier_links = relationship("SupplierMedicine", back_populates="medicine")
    purchase_orders = relationship("PurchaseOrder", back_populates="medicine")


class SupplySource(Base):
    __tablename__ = "supply_sources"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    source_type = Column(String(50), nullable=False)  # MANUFACTURER, DISTRIBUTOR, PHARMACY
    city = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    supplied_medicines = relationship("SupplierMedicine", back_populates="source")
    purchase_orders = relationship("PurchaseOrder", back_populates="source")


class SupplierMedicine(Base):
    __tablename__ = "supplier_medicines"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_id = Column(String(64), ForeignKey("supply_sources.id"), nullable=False, index=True)
    medicine_id = Column(String(64), ForeignKey("medicines.id"), nullable=False, index=True)
    lead_time_days = Column(Integer, nullable=False, default=7)
    unit_price = Column(Float, nullable=False, default=0.0)
    minimum_order_quantity = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    source = relationship("SupplySource", back_populates="supplied_medicines")
    medicine = relationship("Medicine", back_populates="supplier_links")

    __table_args__ = (
        Index("idx_supplier_medicines_source_med", "source_id", "medicine_id"),
    )


class DemandHistory(Base):
    __tablename__ = "demand_history"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    hospital_id = Column(String(64), ForeignKey("hospitals.id"), nullable=False, index=True)
    medicine_id = Column(String(64), ForeignKey("medicines.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    quantity_consumed = Column(Integer, nullable=False)
    patient_load = Column(Integer, default=0)
    emergency_cases = Column(Integer, default=0)
    outbreak_signal = Column(Integer, default=0)

    # relationships
    hospital = relationship("Hospital", back_populates="demand_records")
    medicine = relationship("Medicine", back_populates="demand_records")

    __table_args__ = (
        Index("idx_demand_hosp_med_date", "hospital_id", "medicine_id", "date"),
    )


class InventoryBatch(Base):
    __tablename__ = "inventory_batches"

    id = Column(String(64), primary_key=True)
    hospital_id = Column(String(64), ForeignKey("hospitals.id"), nullable=True, index=True)
    owner_type = Column(String(50), default="HOSPITAL")
    medicine_id = Column(String(64), ForeignKey("medicines.id"), nullable=False, index=True)
    batch_number = Column(String(100), nullable=False)
    quantity = Column(Integer, nullable=False)
    reserved_quantity = Column(Integer, default=0)
    received_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    hospital = relationship("Hospital", back_populates="inventory_batches")
    medicine = relationship("Medicine", back_populates="inventory_batches")

    __table_args__ = (
        Index("idx_inventory_hosp_med", "hospital_id", "medicine_id"),
        Index("idx_inventory_expiry", "expiry_date"),
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String(64), primary_key=True)
    hospital_id = Column(String(64), ForeignKey("hospitals.id"), nullable=False, index=True)
    source_id = Column(String(64), ForeignKey("supply_sources.id"), nullable=False, index=True)
    medicine_id = Column(String(64), ForeignKey("medicines.id"), nullable=False, index=True)
    order_date = Column(Date, nullable=False)
    expected_delivery_date = Column(Date, nullable=False)
    ordered_quantity = Column(Integer, nullable=False)
    received_quantity = Column(Integer, default=0)
    status = Column(String(50), nullable=False, default="PENDING")
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # relationships
    hospital = relationship("Hospital", back_populates="purchase_orders")
    source = relationship("SupplySource", back_populates="purchase_orders")
    medicine = relationship("Medicine", back_populates="purchase_orders")

    __table_args__ = (
        Index("idx_po_hosp_med", "hospital_id", "medicine_id"),
        Index("idx_po_delivery", "expected_delivery_date"),
    )


class AllocationRun(Base):
    """Stored fair-share allocation recommendation awaiting review."""

    __tablename__ = "allocation_runs"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    medicine_id = Column(String(64), nullable=False, index=True)
    medicine_name = Column(String(255), nullable=False)
    params_json = Column(String, nullable=False, default="{}")
    result_json = Column(String, nullable=False, default="{}")
    status = Column(String(20), nullable=False, default="PENDING")  # PENDING, APPROVED, REJECTED
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    approvals = relationship("AllocationApproval", back_populates="run", cascade="all, delete-orphan")


class AllocationApproval(Base):
    """Review decision on an allocation run."""

    __tablename__ = "allocation_approvals"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String(64), ForeignKey("allocation_runs.id"), nullable=False, index=True)
    decision = Column(String(20), nullable=False)  # APPROVED, REJECTED
    reviewer = Column(String(255), nullable=False)
    note = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    run = relationship("AllocationRun", back_populates="approvals")
