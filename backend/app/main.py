from collections import defaultdict, deque
from contextlib import asynccontextmanager
import json
import logging
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from .config import Settings
from .database import engine_for, factory_for
from .errors import ApiError
from . import auth, fleet, company, results, sync, tycoon, social, leaderboards, multiplayer, worlds
from .rooms import RoomManager

logger = logging.getLogger('citybus.api')
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings()
    if cfg.environment != 'development' and not cfg.cookie_secure:
        raise ValueError('COOKIE_SECURE=true is required outside development')
    if cfg.environment == 'production' and any(not origin.startswith('https://') for origin in cfg.cors_origins):
        raise ValueError('Production CORS_ORIGINS must explicitly list HTTPS frontend origins, not localhost defaults')
    engine = engine_for(cfg.database_url)

    @asynccontextmanager
    async def lifespan(app):
        app.state.rooms.start()
        yield
        await app.state.rooms.shutdown()
        engine.dispose()

    app = FastAPI(title='CityBus Driver API', version='0.5.0', lifespan=lifespan,
                  description='Optional offline-first game service, social graph and single-process ghost-bus multiplayer. Currency is integer euro cents.')
    app.state.settings = cfg
    app.state.signing_key = cfg.signing_key()
    app.state.engine = engine
    app.state.sessions = factory_for(engine)
    app.state.rate_buckets = defaultdict(deque)
    app.state.rooms = RoomManager(app)

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        request_id = str(uuid.uuid4())
        start = time.monotonic()
        response = None
        try:
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                origin = request.headers.get('origin')
                if origin and origin not in cfg.cors_origins:
                    return JSONResponse(ApiError(403, 'origin_not_allowed', 'This browser origin is not allowed.').body(), status_code=403)
                if int(request.headers.get('content-length', '0')) > 450000:
                    return JSONResponse(ApiError(413, 'body_too_large', 'Request body exceeds 450 KB.').body(), status_code=413)
                body = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 450000:
                        return JSONResponse(ApiError(413, 'body_too_large', 'Request body exceeds 450 KB.').body(), status_code=413)
                    body.append(chunk)
                request._body = b''.join(body)
            if request.url.path.startswith('/api/') and request.method != 'OPTIONS':
                ip = request.client.host if request.client else 'unknown'
                bucket = app.state.rate_buckets[ip]
                cutoff = time.monotonic() - 60
                while bucket and bucket[0] < cutoff:
                    bucket.popleft()
                if len(bucket) >= cfg.rate_limit_per_minute:
                    return JSONResponse(ApiError(429, 'rate_limited', 'Too many requests. Try again shortly.', {'retry_after': 60}).body(), status_code=429, headers={'Retry-After': '60'})
                bucket.append(time.monotonic())
                if len(app.state.rate_buckets) > 10000:
                    for key in list(app.state.rate_buckets):
                        values = app.state.rate_buckets[key]
                        if not values or values[-1] < cutoff:
                            del app.state.rate_buckets[key]
            response = await call_next(request)
        except Exception as error:
            logger.error(json.dumps({'event': 'unhandled_error', 'request_id': request_id, 'error_type': type(error).__name__}))
            response = JSONResponse(ApiError(500, 'internal_error', 'The server could not complete the request.', {'request_id': request_id}).body(), status_code=500)
        finally:
            logger.info(json.dumps({'event': 'request', 'request_id': request_id, 'method': request.method,
                                    'path': request.url.path, 'status': response.status_code if response else None,
                                    'duration_ms': round((time.monotonic() - start) * 1000, 2)}))
        response.headers['X-Request-ID'] = request_id
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(ApiError)
    async def api_error(_request, error):
        headers = {'Retry-After': str(error.details.get('retry_after', 60))} if error.status == 429 else {}
        return JSONResponse(error.body(), status_code=error.status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, error):
        issues = [{'path': list(e['loc']), 'message': e['msg'], 'type': e['type']} for e in error.errors()]
        return JSONResponse(ApiError(422, 'validation_error', 'Check the submitted fields.', {'issues': issues}).body(), status_code=422)

    @app.exception_handler(HTTPException)
    async def http_error(_request, error):
        return JSONResponse(ApiError(error.status_code, 'http_error', str(error.detail)).body(), status_code=error.status_code)

    @app.exception_handler(IntegrityError)
    async def integrity_error(_request, _error):
        return JSONResponse(ApiError(409, 'resource_conflict', 'A conflicting record already exists. Reload before retrying.').body(), status_code=409)

    @app.exception_handler(OperationalError)
    async def database_error(_request, _error):
        return JSONResponse(ApiError(503, 'database_unavailable', 'Database unavailable. Check migrations and retry later.').body(), status_code=503)

    @app.get('/api/health', tags=['Operations'])
    def health():
        with engine.connect() as connection:
            connection.execute(text('SELECT version_num FROM alembic_version'))
        return {'status': 'ok', 'version': '0.5.0'}

    @app.get('/health', tags=['Operations'])
    @app.get('/api/ready', tags=['Operations'])
    def ready():
        with engine.connect() as connection:
            revision = connection.execute(text('SELECT version_num FROM alembic_version')).scalar()
            count = connection.execute(text('SELECT count(*) FROM world_definitions')).scalar()
        if revision != '0004' or count < 4:
            raise ApiError(503, 'not_ready', 'Run migrations and seed before serving traffic.')
        return {'status': 'ready', 'schema': revision, 'room_scope': 'single-process'}

    for router in (auth.router, fleet.router, company.router, results.router, sync.router, tycoon.router, social.router, leaderboards.router, multiplayer.router, worlds.router):
        app.include_router(router, prefix='/api')
    # CORS is outermost, including centralized error responses.
    app.add_middleware(CORSMiddleware, allow_origins=cfg.cors_origins, allow_credentials=True,
                       allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
                       allow_headers=['Authorization', 'Content-Type'], expose_headers=['Retry-After', 'X-Request-ID'])
    return app


app = create_app()
