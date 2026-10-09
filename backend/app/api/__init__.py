"""API routers composition for MedPredict and contract endpoints."""

from fastapi import APIRouter

from app.api import (
    allocation,
    assistant,
    auth,
    core_routes,
    dashboard,
    demand,
    facilities,
    forecasts,
    helpdesk,
    hospitals,
    inventory,
    medicines,
    procurement,
    redistribution,
    risks,
    scenarios,
    simulation,
)

#: Mounted under /api/v1 (canonical contract paths)
api_v1_router = APIRouter()
api_v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_v1_router.include_router(allocation.router, prefix="/allocation", tags=["allocation"])
api_v1_router.include_router(facilities.router, prefix="/facilities", tags=["facilities"])
api_v1_router.include_router(hospitals.router, prefix="/hospitals", tags=["hospitals"])
api_v1_router.include_router(medicines.router, prefix="/medicines", tags=["medicines"])
api_v1_router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
api_v1_router.include_router(demand.router, prefix="/demand", tags=["demand"])
api_v1_router.include_router(forecasts.router, prefix="/forecast", tags=["forecasting"])
api_v1_router.include_router(forecasts.router, prefix="/forecasts", tags=["forecasting"])
api_v1_router.include_router(risks.router, prefix="/risks", tags=["risk"])
api_v1_router.include_router(procurement.router, prefix="/procurement", tags=["procurement"])
api_v1_router.include_router(simulation.router, prefix="/simulation", tags=["simulation"])
api_v1_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_v1_router.include_router(redistribution.router, prefix="/redistribution", tags=["redistribution"])
api_v1_router.include_router(scenarios.router, prefix="/scenarios", tags=["scenarios"])
api_v1_router.include_router(assistant.router, prefix="/assistant", tags=["assistant"])
api_v1_router.include_router(helpdesk.router, prefix="/helpdesk", tags=["helpdesk"])

#: Core router mounted under root
api_router = APIRouter()
api_router.include_router(api_v1_router, prefix="/api/v1")
api_router.include_router(core_routes.router, tags=["core"])

# Convenience paths for frontend without /v1
api_router.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
api_router.include_router(hospitals.router, prefix="/api/hospitals", tags=["hospitals"])
api_router.include_router(medicines.router, prefix="/api/medicines", tags=["medicines"])
api_router.include_router(procurement.router, prefix="/api/procurement", tags=["procurement"])
api_router.include_router(simulation.router, prefix="/api/simulation", tags=["simulation"])
