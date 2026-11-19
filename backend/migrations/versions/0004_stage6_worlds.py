"""World catalog and map/class board partitions; existing data retained."""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('world_definitions', sa.Column('id', sa.String(30), primary_key=True), sa.Column('revision', sa.Integer(), nullable=False), sa.Column('document', sa.JSON(), nullable=False))
    op.add_column('board_entries', sa.Column('map_id', sa.String(30), nullable=False, server_default='northbank'))
    op.add_column('board_entries', sa.Column('bus_class', sa.String(30), nullable=False, server_default='city'))
    op.create_index('ix_board_entries_map_id', 'board_entries', ['map_id'])
    op.create_index('ix_board_entries_bus_class', 'board_entries', ['bus_class'])
    op.add_column('room_participations', sa.Column('map_id', sa.String(30), nullable=False, server_default='northbank'))
    # Old route payloads identify the owned bus, if present. Backfill class from
    # relational ownership rather than treating every historical route as a city bus.
    # JSON extraction differs by database; seed() also repairs retained route rows.


def downgrade():
    op.drop_column('room_participations', 'map_id')
    op.drop_index('ix_board_entries_bus_class', table_name='board_entries')
    op.drop_index('ix_board_entries_map_id', table_name='board_entries')
    op.drop_column('board_entries', 'bus_class')
    op.drop_column('board_entries', 'map_id')
    op.drop_table('world_definitions')
