from alembic import context
from app.config import Settings
from app.database import engine_for
from app.models import Base

config = context.config
target_metadata = Base.metadata
url = config.attributes.get('database_url') or Settings().database_url
if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={'paramstyle': 'named'})
    with context.begin_transaction():
        context.run_migrations()
else:
    connectable = engine_for(url)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_as_batch=connection.dialect.name == 'sqlite')
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()
