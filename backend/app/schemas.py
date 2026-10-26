"""요청/응답 검증 (pydantic)"""
from pydantic import BaseModel, Field


class PlanRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    buffer_min: int | None = Field(default=None, ge=0, le=30)


class CreateRoomRequest(BaseModel):
    place_label: str = Field(default="", max_length=50)
    lat: float
    lng: float


class JoinRoomRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class UpdateMyStatusRequest(BaseModel):
    status: str = Field(pattern="^(staying|leaving|arrived)$")


class WalkTripRequest(BaseModel):
    distance_m: int = Field(gt=0, lt=10_000)
    minutes: float = Field(gt=0, lt=300)


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: dict[str, str]  # {"p256dh": ..., "auth": ...}
