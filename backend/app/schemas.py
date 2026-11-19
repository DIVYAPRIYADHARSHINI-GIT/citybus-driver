from datetime import datetime
import json
import re
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Amount = Annotated[int, Field(strict=True, ge=0, le=100000000)]
Percent = Annotated[int, Field(strict=True, ge=0, le=100)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Credentials(StrictModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator('email')
    @classmethod
    def email_address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address')
        return value


class Register(Credentials):
    display_name: str = Field(min_length=2, max_length=60)

    @field_validator('display_name')
    @classmethod
    def name(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError('Enter a display name without control characters')
        return value


class ProfilePatch(StrictModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=60)
    avatar: Literal['driver-green', 'driver-blue', 'driver-gold', 'driver-red'] | None = None
    settings: dict | None = None

    @field_validator('settings')
    @classmethod
    def bounded_settings(cls, value):
        if value is not None and len(json.dumps(value, allow_nan=False)) > 8192:
            raise ValueError('Settings exceed 8 KB')
        return value


class Operation(StrictModel):
    operation_id: UUID


class Purchase(Operation):
    model_id: str = Field(max_length=40)


class OwnedPatch(StrictModel):
    paint: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')


class Upgrade(Operation):
    upgrade: Literal['comfort', 'luggage']


class Hire(Operation):
    template_id: str = Field(max_length=40)


class Train(Operation):
    skill: Literal['safety', 'economy', 'service']


class RoutePlan(StrictModel):
    departure_minutes: list[Annotated[int, Field(strict=True, ge=0, le=1439)]] = Field(max_length=96)
    ticket_price: Annotated[int, Field(strict=True, ge=100, le=1000)]

    @field_validator('departure_minutes')
    @classmethod
    def ordered(cls, value):
        if value != sorted(set(value)):
            raise ValueError('Departures must be ordered and unique')
        return value


class ScorePayload(StrictModel):
    id: Literal['21', '36', '80', 'M1', 'M2', 'H1', 'H2']
    score: Amount
    fares: Amount
    expenses: Amount
    served: Annotated[int, Field(strict=True, ge=0, le=6)]
    missed: Annotated[int, Field(strict=True, ge=0, le=6)]
    comfort: Percent
    penalties: Amount
    punctuality: Percent


class FleetDelta(StrictModel):
    base_revision: int = Field(ge=0)
    energy_used: int = Field(ge=0, le=1000000)
    wear_added: dict[str, Annotated[int, Field(strict=True, ge=0, le=3000)]]

    @field_validator('wear_added')
    @classmethod
    def wear_parts(cls, value):
        if set(value) != {'engine', 'brakes', 'tires', 'energy'}:
            raise ValueError('Include exactly engine, brakes, tires and energy wear')
        return value


class RouteSubmission(StrictModel):
    run_id: UUID
    finished_at: datetime
    seconds: float = Field(ge=0, le=86400)
    meters: float = Field(ge=0, le=500000)
    liters: float = Field(ge=0, le=1000)
    impacts: Annotated[int, Field(strict=True, ge=0, le=1000)]
    route: ScorePayload
    owned_bus_id: UUID | None = None
    fleet_delta: FleetDelta | None = None

    @field_validator('finished_at')
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError('finished_at must include its UTC offset')
        return value


class SavedSession(StrictModel):
    date: datetime
    seconds: float = Field(ge=0, le=100000000)
    meters: float = Field(ge=0, le=100000000)
    liters: float = Field(ge=0, le=100000000)
    impacts: Annotated[int, Field(strict=True, ge=0, le=100000000)]
    route: ScorePayload | None = None
    runId: UUID | None = None


class CitySettings(StrictModel):
    density: Literal['low', 'medium', 'high']


class GameSave(StrictModel):
    version: Literal[1]
    paint: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')
    quality: Literal['low', 'balanced', 'high']
    weather: Literal['clear', 'rain', 'fog', 'snow', 'jam']
    hour: float = Field(ge=0, le=24)
    volume: float = Field(ge=0, le=1)
    sessions: list[SavedSession] = Field(max_length=500)
    tutorial: bool
    city: CitySettings | None = None


class SaveRequest(Operation):
    base_version: Annotated[int, Field(strict=True, ge=0)]
    client_id: UUID
    document: GameSave

    @model_validator(mode='after')
    def size_limit(self):
        if len(self.document.model_dump_json()) > 400000:
            raise ValueError('Cloud save exceeds 400 KB')
        return self


class ResolveRequest(Operation):
    choice: Literal['local', 'server']
    expected_version: Annotated[int, Field(strict=True, ge=0)]
