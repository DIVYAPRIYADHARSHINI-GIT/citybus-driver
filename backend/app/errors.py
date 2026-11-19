from dataclasses import dataclass, field
from typing import Any


@dataclass
class ApiError(Exception):
    status: int
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def body(self):
        return {'error': {'code': self.code, 'message': self.message, 'details': self.details}}
